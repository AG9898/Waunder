require "net/http"
require "json"

# Fetches the full body of a received (inbound) email from Resend.
#
# Resend's `email.received` webhook payload carries only metadata (from/to/
# subject/email_id/attachments) — it does NOT include the message body. The
# body is retrieved separately via `GET /emails/receiving/{email_id}` with the
# account API key. This client owns that single call so the rest of the inbound
# pipeline can treat the body as if it had arrived on the webhook.
#
# Guardrails mirror OpenrouterClient:
# - Raises MissingApiKeyError when RESEND_API_KEY is absent so callers can skip
#   gracefully instead of crashing.
# - Exposes an `http:` transport seam so specs never hit the network.
# - Never logs body contents (PII); only non-content metadata (status).
class ResendInboundClient
  ENDPOINT = "https://api.resend.com/emails/receiving".freeze
  OPEN_TIMEOUT = 10
  READ_TIMEOUT = 30

  # Base error so callers can rescue any fetch failure with one class.
  class Error < StandardError; end

  # Raised when no API key is configured. Callers guard on this to skip body
  # hydration gracefully (the metadata-only email is still parsed/flagged).
  class MissingApiKeyError < Error; end

  # Raised on a non-success response or a transport failure.
  class RequestError < Error; end

  def initialize(api_key: ENV["RESEND_API_KEY"], http: nil)
    @api_key = api_key.to_s.strip
    @http = http
    raise MissingApiKeyError, "RESEND_API_KEY is not configured" if @api_key.empty?
  end

  # Returns the received-email object as a Hash with stringified keys (includes
  # "text", "html", "from", "subject") for the given Resend received-email id.
  def fetch(email_id)
    id = email_id.to_s.strip
    raise RequestError, "email_id is required" if id.empty?

    uri = URI("#{ENDPOINT}/#{id}")
    request = Net::HTTP::Get.new(uri)
    request["Authorization"] = "Bearer #{@api_key}"
    request["Accept"] = "application/json"

    response = client.request(uri, request)
    status = response.code.to_i
    unless status.between?(200, 299)
      log("fetch_failed", status: status)
      raise RequestError, "Resend receiving fetch failed with status #{status}"
    end

    JSON.parse(response.body)
  rescue JSON::ParserError
    raise RequestError, "Resend receiving fetch returned invalid JSON"
  rescue Timeout::Error, IOError, SystemCallError => e
    raise RequestError, "Resend receiving fetch failed: #{e.class.name}"
  end

  private

  # Thin seam so tests can inject a fake transport without live calls.
  def client
    @http || NetHttpTransport
  end

  # Default transport using stdlib Net::HTTP with timeouts.
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

  # Logs non-content metadata only — never body text (PII).
  def log(event, **fields)
    detail = fields.map { |k, v| "#{k}=#{v}" }.join(" ")
    Rails.logger.info("ResendInboundClient #{event} #{detail}".strip)
  end
end
