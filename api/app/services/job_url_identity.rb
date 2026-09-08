require "uri"

# Produces a stable, host-aware identity key without fetching the supplied URL.
class JobUrlIdentity
  TRACKING_PARAMETERS = %w[
    _ga _gl dclid fbclid gclid li_fat_id mc_cid mc_eid midtoken msclkid
    lipi trackingid trk
  ].freeze

  def self.key(url)
    new(url).key
  end

  def initialize(url)
    @url = url.to_s.strip
  end

  def key
    uri = URI.parse(@url)
    return nil unless http_url?(uri)

    linked_in_job_id(uri) || generic_key(uri)
  rescue URI::InvalidURIError, ArgumentError, Encoding::InvalidByteSequenceError,
         Encoding::UndefinedConversionError
    nil
  end

  private

  def http_url?(uri)
    %w[http https].include?(uri.scheme.to_s.downcase) && uri.host.to_s.present?
  end

  def linked_in_job_id(uri)
    host = uri.host.downcase.delete_prefix("www.")
    return unless host == "linkedin.com" || host.end_with?(".linkedin.com")

    match = uri.path.match(%r{\A/(?:comm/)?jobs/view/(\d+)/?\z}i)
    "linkedin:#{match[1]}" if match
  end

  def generic_key(uri)
    scheme = uri.scheme.downcase
    host = uri.host.downcase
    port = uri.port
    authority = port == uri.default_port ? host : "#{host}:#{port}"
    path = uri.path.presence || "/"
    query = normalized_query(uri.query)

    key = "url:#{scheme}://#{authority}#{path}"
    key += "?#{query}" if query.present?
    key += "##{uri.fragment}" if uri.fragment.present?
    key
  end

  def normalized_query(query)
    return if query.nil?

    pairs = URI.decode_www_form(query).reject { |name, _value| tracking_parameter?(name) }
    URI.encode_www_form(pairs.sort) if pairs.any?
  end

  def tracking_parameter?(name)
    normalized = name.downcase
    normalized.start_with?("utm_") || TRACKING_PARAMETERS.include?(normalized)
  end
end
