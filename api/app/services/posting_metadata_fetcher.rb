require "net/http"
require "json"
require "uri"
require "resolv"
require "ipaddr"

# Fetches a job posting URL and deterministically extracts its title, company,
# location, compensation, and description.
#
# This is the ONLY place in the app that fetches an owner-supplied URL. It is
# kept out of ManualJobPostImporter on purpose: import normalization stays
# offline and deterministic (see MANUAL-01), while this service is invoked
# explicitly — by the manual-entry lookup endpoint before submit, and by
# EnrichJobPostJob after an import that had no owner-supplied title/company.
#
# Extraction is deterministic — never the LLM. Known job hosts are read through
# their own public, unauthenticated endpoints (which return structured data);
# everything else falls back to page HTML: JSON-LD JobPosting, then OpenGraph,
# then a `<title>` split on the conventional "<title> at <company>" patterns.
#
# Guardrails:
# - Only HTTP(S) URLs, and never an address that resolves into a private,
#   loopback, or link-local range (the fetch target is user-supplied, so this
#   endpoint must not become an internal-network probe).
# - Bounded redirects, timeouts, and response size.
# - Never raises for an unreachable or unparseable page; returns an
#   `unavailable` Result so callers degrade to manual entry.
class PostingMetadataFetcher
  OPEN_TIMEOUT = 5
  READ_TIMEOUT = 10
  MAX_REDIRECTS = 3
  MAX_BODY_BYTES = 8_000_000
  USER_AGENT = "Mozilla/5.0 (compatible; Waunder/1.0; +https://github.com/AG9898/Waunder)".freeze

  # Blank-safe extraction result. `status` is one of:
  #   "ok"          — at least one field was extracted
  #   "unsupported" — not an HTTP(S) URL, or a blocked address
  #   "unavailable" — fetched but nothing could be extracted, or the fetch failed
  Result = Struct.new(
    :status, :title, :company, :location, :compensation, :description, :provider, :error,
    keyword_init: true
  ) do
    def ok? = status == "ok"

    def fields
      { title: title, company: company, location: location, compensation: compensation, description: description }
        .compact_blank
    end
  end

  def initialize(url, http: nil)
    @url = url.to_s.strip
    @http = http
  end

  def call
    uri = parse_uri
    return unsupported("Provide an HTTP or HTTPS job URL") unless uri
    return unsupported("That address is not reachable") unless public_address?(uri)

    fields = extract(uri)
    return unavailable if fields.blank?

    Result.new(status: "ok", provider: @provider, **fields)
  rescue FetchError => e
    unavailable(e.message)
  end

  private

  FetchError = Class.new(StandardError)

  attr_reader :url

  def parse_uri
    uri = URI.parse(url)
    return unless %w[http https].include?(uri.scheme.to_s.downcase) && uri.host.present?

    uri
  rescue URI::InvalidURIError, ArgumentError
    nil
  end

  # Rejects hosts that resolve into non-public ranges so an owner-pasted URL
  # cannot be used to reach Railway's private network or localhost.
  def public_address?(uri)
    addresses = Resolv.getaddresses(uri.host)
    return false if addresses.empty?

    addresses.none? { |address| blocked_address?(address) }
  rescue StandardError
    false
  end

  def blocked_address?(address)
    ip = IPAddr.new(address)
    ip.loopback? || ip.private? || ip.link_local?
  rescue IPAddr::Error
    true
  end

  # --- extraction strategies -------------------------------------------------

  # Dispatches to the host-specific reader when there is one, and otherwise
  # parses the page itself. Every strategy returns a Hash of extracted fields
  # (possibly empty); nil means "this strategy does not apply".
  def extract(uri)
    host = uri.host.to_s.downcase.delete_prefix("www.")

    strategy =
      if linked_in_host?(host) then :linked_in
      elsif host.end_with?("greenhouse.io") then :greenhouse
      elsif host.end_with?("lever.co") then :lever
      elsif host.end_with?("ashbyhq.com") then :ashby
      else :generic
      end

    @provider = strategy.to_s
    fields = send("extract_#{strategy}", uri)
    return fields if fields.present?

    # A known host that yielded nothing still deserves the generic page pass.
    return nil if strategy == :generic

    @provider = "generic"
    extract_generic(uri)
  end

  # The guest top card wraps the description in a div whose own children include
  # divs, so the closing tag cannot be matched by a non-greedy scan. The markup
  # block is instead cut at the section that always follows it.
  def linked_in_description(html)
    body = html[%r{show-more-less-html__markup[^>]*>(.*)}mi, 1]
    return if body.blank?

    body.split(%r{<(?:/section|section|footer)\b}mi, 2).first
  end

  def linked_in_host?(host)
    host == "linkedin.com" || host.end_with?(".linkedin.com")
  end

  # LinkedIn's public guest endpoint renders a job's top card without a session;
  # the signed-in /jobs/view/<id> page redirects anonymous fetches to the
  # authwall, so the job id is mapped onto the guest URL instead.
  def extract_linked_in(uri)
    match = uri.path.match(%r{/(?:comm/)?jobs/view/(\d+)}i)
    return unless match

    html = fetch_body(URI("https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/#{match[1]}"))
    return if html.blank?

    {
      title: text_of(html[%r{class="[^"]*topcard__title[^"]*"[^>]*>(.*?)</h2>}mi, 1]),
      company: text_of(html[%r{class="[^"]*topcard__org-name-link[^"]*"[^>]*>(.*?)</a>}mi, 1]),
      location: text_of(html[%r{class="[^"]*topcard__flavor--bullet[^"]*"[^>]*>(.*?)</span>}mi, 1]),
      description: html_to_text(linked_in_description(html))
    }.compact_blank
  end

  # Greenhouse job boards expose every posting through their public board API,
  # which carries the company name the rendered page only implies.
  def extract_greenhouse(uri)
    match = uri.path.match(%r{\A/(?:embed/job_app\?for=)?([^/]+)/jobs/(\d+)}i)
    return unless match

    payload = fetch_json(URI("https://boards-api.greenhouse.io/v1/boards/#{match[1]}/jobs/#{match[2]}"))
    return if payload.blank?

    {
      title: text_of(payload["title"]),
      company: text_of(payload["company_name"]).presence || humanize_slug(match[1]),
      location: text_of(payload.dig("location", "name")),
      description: html_to_text(payload["content"])
    }.compact_blank
  end

  def extract_lever(uri)
    match = uri.path.match(%r{\A/([^/]+)/([0-9a-f-]{16,})}i)
    return unless match

    payload = fetch_json(URI("https://api.lever.co/v0/postings/#{match[1]}/#{match[2]}"))
    return if payload.blank?

    {
      title: text_of(payload["text"]),
      company: humanize_slug(match[1]),
      location: text_of(payload.dig("categories", "location")),
      description: text_of(payload["descriptionPlain"]).presence || html_to_text(payload["description"])
    }.compact_blank
  end

  # Ashby job pages are client-rendered, so the posting is read from the board's
  # public posting API and matched on the job id in the URL.
  def extract_ashby(uri)
    match = uri.path.match(%r{\A/([^/]+)/([0-9a-f-]{16,})}i)
    return unless match

    payload = fetch_json(URI("https://api.ashbyhq.com/posting-api/job-board/#{match[1]}?includeCompensation=true"))
    posting = Array(payload.is_a?(Hash) ? payload["jobs"] : payload)
      .find { |job| job.is_a?(Hash) && job["id"].to_s.casecmp?(match[2]) }
    return if posting.blank?

    {
      title: text_of(posting["title"]),
      company: humanize_slug(match[1]),
      location: text_of(posting["location"]),
      compensation: text_of(posting.dig("compensation", "compensationTierSummary")),
      description: text_of(posting["descriptionPlain"]).presence || html_to_text(posting["descriptionHtml"])
    }.compact_blank
  end

  # Page-level fallback for any other host, in descending order of reliability:
  # schema.org JobPosting JSON-LD, then OpenGraph, then the document title.
  def extract_generic(uri)
    html = fetch_body(uri)
    return if html.blank?

    fields = json_ld_fields(html) || {}
    meta = meta_fields(html)

    fields[:title] = fields[:title].presence || meta[:title]
    fields[:company] = fields[:company].presence || meta[:company]
    fields.compact_blank
  end

  # --- generic HTML/JSON-LD parsing -----------------------------------------

  def json_ld_fields(html)
    html.scan(%r{<script[^>]*type=["']application/ld\+json["'][^>]*>(.*?)</script>}mi).each do |(raw)|
      posting = job_posting_node(safe_json(raw))
      next if posting.blank?

      return {
        title: text_of(posting["title"]),
        company: text_of(organization_name(posting["hiringOrganization"])),
        location: text_of(job_location(posting["jobLocation"])),
        compensation: text_of(base_salary(posting["baseSalary"])),
        description: html_to_text(posting["description"])
      }.compact_blank
    end
    nil
  end

  # Walks a JSON-LD document (which may be a graph, a list, or a single node)
  # for the first schema.org JobPosting.
  def job_posting_node(node)
    case node
    when Array then node.lazy.filter_map { |child| job_posting_node(child) }.first
    when Hash
      return node if Array(node["@type"]).any? { |type| type.to_s.casecmp?("JobPosting") }

      job_posting_node(node["@graph"])
    end
  end

  def organization_name(value)
    case value
    when String then value
    when Hash then value["name"]
    when Array then organization_name(value.first)
    end
  end

  def job_location(value)
    case value
    when Array then job_location(value.first)
    when Hash
      address = value["address"].is_a?(Hash) ? value["address"] : value
      [ address["addressLocality"], address["addressRegion"], address["addressCountry"] ]
        .filter_map { |part| part.is_a?(Hash) ? part["name"] : part }
        .filter_map { |part| part.to_s.strip.presence }
        .uniq.join(", ")
    when String then value
    end
  end

  def base_salary(value)
    return value if value.is_a?(String)
    return unless value.is_a?(Hash)

    amount = value["value"].is_a?(Hash) ? value["value"] : value
    low = amount["minValue"] || amount["value"]
    high = amount["maxValue"]
    currency = value["currency"] || amount["currency"]
    range = [ low, high ].filter_map { |part| part.to_s.strip.presence }.uniq.join("–")
    return if range.blank?

    [ currency, range, amount["unitText"]&.to_s&.downcase ].filter_map(&:presence).join(" ")
  end

  # OpenGraph and <title>. Most job hosts title their pages with one of a few
  # conventional "<job title> at <company>" shapes, so the company is recovered
  # by splitting the document title against the OpenGraph title.
  def meta_fields(html)
    og_title = text_of(html[%r{<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']}mi, 1])
    site_name = text_of(html[%r{<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']}mi, 1])
    doc_title = text_of(html[%r{<title[^>]*>(.*?)</title>}mi, 1])

    title, company = split_document_title(doc_title)
    {
      title: og_title.presence || title,
      company: site_name.presence || company
    }.compact_blank
  end

  DOCUMENT_TITLE_PATTERNS = [
    /\AJob Application for (?<title>.+?) at (?<company>.+)\z/i,
    /\A(?<title>.+?) (?:-|–|—|\|) (?<company>.+?) (?:Careers|Jobs|Job Board)\z/i,
    /\A(?<title>.+?) at (?<company>.+)\z/i,
    /\A(?<title>.+?) (?:-|–|—|\|) (?<company>.+)\z/i
  ].freeze

  def split_document_title(doc_title)
    return [ nil, nil ] if doc_title.blank?

    DOCUMENT_TITLE_PATTERNS.each do |pattern|
      match = doc_title.match(pattern)
      next unless match

      return [ text_of(match[:title]), text_of(match[:company]) ]
    end
    [ doc_title, nil ]
  end

  # --- transport -------------------------------------------------------------

  def fetch_json(uri)
    body = fetch_body(uri, accept: "application/json")
    return if body.blank?

    safe_json(body)
  end

  # Follows a bounded number of redirects and returns the response body, or nil
  # for any non-success status. Transport failures raise FetchError so `call`
  # can degrade to an `unavailable` Result.
  def fetch_body(uri, accept: "text/html,application/xhtml+xml", redirects: MAX_REDIRECTS)
    request = Net::HTTP::Get.new(uri)
    request["User-Agent"] = USER_AGENT
    request["Accept"] = accept
    request["Accept-Language"] = "en"

    response = client.request(uri, request)
    status = response.code.to_i

    if status.between?(300, 399) && response["location"].present? && redirects.positive?
      target = URI.join(uri.to_s, response["location"])
      return nil unless %w[http https].include?(target.scheme.to_s.downcase) && public_address?(target)

      return fetch_body(target, accept: accept, redirects: redirects - 1)
    end

    return nil unless status.between?(200, 299)

    response.body.to_s.byteslice(0, MAX_BODY_BYTES).to_s.dup.force_encoding(Encoding::UTF_8)
      .scrub("")
  rescue Timeout::Error, IOError, SystemCallError, URI::Error, OpenSSL::SSL::SSLError, Net::HTTPBadResponse,
         Net::HTTPHeaderSyntaxError, EOFError, Zlib::Error => e
    raise FetchError, "Could not read the posting (#{e.class.name})"
  end

  def client
    @http || NetHttpTransport
  end

  module NetHttpTransport
    module_function

    def request(uri, request)
      Net::HTTP.start(
        uri.host,
        uri.port,
        use_ssl: uri.scheme == "https",
        open_timeout: OPEN_TIMEOUT,
        read_timeout: READ_TIMEOUT
      ) { |http| http.request(request) }
    end
  end

  # --- text helpers ----------------------------------------------------------

  def text_of(value)
    raw = value.to_s
    return "" if raw.empty?

    CGI.unescapeHTML(raw.gsub(/<[^>]+>/, " ")).gsub(/[[:space:]]+/, " ").strip
  end

  def html_to_text(value)
    raw = value.to_s
    return "" if raw.empty?

    # Some sources (Greenhouse) return the description as entity-escaped markup
    # inside JSON, so entities are resolved before tags are stripped.
    raw = CGI.unescapeHTML(raw) while raw.include?("&lt;") && (raw = CGI.unescapeHTML(raw))

    text = raw.gsub(%r{<br\s*/?>}i, "\n")
      .gsub(%r{</(?:p|div|li|h[1-6]|tr)>}i, "\n")
      .gsub(%r{<li[^>]*>}i, "• ")
      .gsub(/<[^>]+>/, "")
    CGI.unescapeHTML(text).gsub(/[ \t ]+/, " ").gsub(/\n{3,}/, "\n\n").strip
  end

  def humanize_slug(slug)
    slug.to_s.tr("-_", " ").split.map(&:capitalize).join(" ").presence
  end

  def safe_json(raw)
    JSON.parse(raw.to_s)
  rescue JSON::ParserError
    nil
  end

  def unsupported(message) = Result.new(status: "unsupported", error: message)

  def unavailable(message = nil)
    Result.new(status: "unavailable", error: message || "Could not read the title and company from that link")
  end
end
