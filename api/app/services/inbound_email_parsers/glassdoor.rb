module InboundEmailParsers
  # Parses Glassdoor "Jobs for You" job-alert emails.
  #
  # Real Glassdoor alerts (including ones the owner manually forwards from Gmail)
  # repeat a posting block of the form:
  #
  #   DataAnnotation 4.1 ★                         <- "Company <rating> ★"
  #   AI Training Specialist – Quantitative        <- title
  #   Hamilton                                     <- location
  #   $55 - $60 (Employer Est.)                    <- salary (optional)
  #   Easy Apply                                   <- apply flag (optional)
  #   5d                                           <- posting age (optional)
  #   <https://www.glassdoor.ca/partner/jobListing.htm?...&jobListingId=123...>
  #
  # The job link is the deterministic end-of-block anchor. It is matched on the
  # `job-listing` / `partner/jobListing` path on ANY Glassdoor TLD (`.com`,
  # `.ca`, `.co.uk`, …) — NOT the `/Job/jobs.htm` search link in the header,
  # which would otherwise be mistaken for a posting. Each block is read by
  # walking backwards from the link to the nearest "Company <rating> ★" line so
  # the manual-forward wrapper (filler chars, `[image:]` alts, promo/header
  # lines) can sit between blocks without corrupting extraction.
  class Glassdoor < Base
    # A Glassdoor application/listing link on any Glassdoor TLD. Excludes the
    # `/Job/jobs.htm` search link used in the alert header.
    JOB_URL = %r{https?://(?:[\w.-]+\.)?glassdoor\.[a-z.]+/(?:job-listing|partner/jobListing)[^\s)>"']*}i
    # The stable numeric listing id carried in the partner-redirect link.
    LISTING_ID = /jobListingId=(\d+)/i
    # A "Company <rating> ★" line — the block-start anchor (★ is U+2605).
    COMPANY_RATING = /\A(?<company>.+?)\s+\d(?:\.\d+)?\s*★\s*\z/u
    # A salary/compensation line (e.g. "$55 - $60 (Employer Est.)").
    SALARY = /\$\s*[\d.,]+\s*[KkMm]?/
    # Apply-flag / age / boilerplate lines that are never the location.
    META = Regexp.union(
      /\Aeasy apply\z/i,
      /\A\d+\+?\s*(?:d|h|m|days?|hours?|months?)\b/i,
      /\A(?:new|promoted|actively hiring)\b/i
    )
    # Zero-width / bidi filler characters Gmail/Glassdoor pad the body with.
    FILLER = /[͏​-‏  ‪-‮﻿]/

    def self.source_name
      "glassdoor"
    end

    def self.sender_domains
      %w[glassdoor.com glassdoormail.com].freeze
    end

    def parse
      lines = cleaned_lines
      previous_url_index = -1

      lines.each_index.filter_map do |index|
        url = lines[index][JOB_URL]
        next unless url

        block = block_for(lines, index, previous_url_index)
        previous_url_index = index
        next if block.nil?

        build(block, url)
      end
    end

    private

    # Lines with whitespace stripped, filler removed, and empty / image-alt
    # lines dropped — but block order preserved.
    def cleaned_lines
      body.split("\n").filter_map do |raw|
        line = raw.sub(/\A>\s?/, "").gsub(FILLER, "").strip
        next if line.empty? || line.start_with?("[image:")

        line
      end
    end

    # Assemble one posting from the lines preceding the link, bounded by the
    # previous block's link so blocks never bleed together. Prefers the real
    # "Jobs for You" layout (anchored on a "Company <rating> ★" line); falls
    # back to the simpler "title / Company — Location" layout for canonical
    # job-listing alerts that carry no rating line.
    def block_for(lines, url_index, previous_url_index)
      fields = lines[(previous_url_index + 1)...url_index].reject { |l| l[JOB_URL] }
      return nil if fields.empty?

      rating_index = fields.rindex { |l| l.match?(COMPANY_RATING) }
      rating_index ? rated_block(fields, rating_index) : legacy_block(fields)
    end

    # "Company <rating> ★" / title / location / salary layout.
    def rated_block(fields, rating_index)
      company = fields[rating_index][COMPANY_RATING, 1]
      rest = fields[(rating_index + 1)..]
      return nil if company.blank? || rest.empty?

      title = rest.shift
      salary = rest.find { |l| l.match?(SALARY) }
      location = rest.find { |l| !l.match?(SALARY) && !l.match?(META) }
      { company: company, title: title, location: location, salary: salary }
    end

    # Legacy "title / Company — Location" layout (the two lines before the link).
    COMPANY_LOCATION = /\A(?<company>.+?)\s+[—–-]\s+(?<location>.+)\z/
    def legacy_block(fields)
      return nil if fields.size < 2

      title = fields[-2]
      company_location = fields[-1].match(COMPANY_LOCATION)
      company = company_location ? company_location[:company] : fields[-1]
      location = company_location ? company_location[:location] : nil
      { company: company, title: title, location: location, salary: nil }
    end

    def build(block, url)
      id = url[LISTING_ID, 1]
      posting(
        title: block[:title],
        company: block[:company],
        location: block[:location],
        compensation: block[:salary],
        posting_url: canonical_url(url, id),
        source_url: url
      )
    end

    # A stable, token-free canonical listing URL for dedup and manual apply,
    # built from the listing id when present; otherwise the matched link.
    def canonical_url(url, id)
      return url if id.blank?

      host = url[%r{https?://([\w.-]+)}i, 1] || "www.glassdoor.com"
      "https://#{host}/job-listing/index.htm?jl=#{id}"
    end

    # Prefer the plain-text body; fall back to a tag-stripped HTML body.
    def body
      return text unless text.strip.empty?

      ActionView::Base.full_sanitizer.sanitize(html).to_s
    end
  end
end
