require "net/http"
require "json"

# Isolated client for the OpenRouter LLM gateway.
#
# Owns every outbound LLM call for the api/ service. Reads OPENROUTER_API_KEY
# and OPENROUTER_MODEL from the environment (model defaults to the free-tier
# `google/gemma-4-31b-it:free`, RESOLVED-17). Because free-tier models impose
# rate limits and offer only loose structured-output guarantees, the client
# requests JSON output where supported and degrades gracefully: it retries on
# transient/rate-limit responses and, when the model returns prose around the
# JSON, extracts the first balanced JSON object/array (parse fallback) rather
# than assuming strict schema enforcement.
#
# Guardrails:
# - Raises MissingApiKeyError (a typed error) when OPENROUTER_API_KEY is absent
#   so callers can guard/skip instead of crashing.
# - Never logs prompt or completion contents, which may contain PII. Only
#   non-content metadata (model, status, attempt) is logged.
class OpenrouterClient
  DEFAULT_MODEL = "google/gemma-4-31b-it:free".freeze
  ENDPOINT = "https://openrouter.ai/api/v1/chat/completions".freeze
  DEFAULT_MAX_RETRIES = 2
  RETRYABLE_STATUSES = [ 408, 429, 500, 502, 503, 504 ].freeze
  OPEN_TIMEOUT = 10
  READ_TIMEOUT = 60

  # Base error so callers can rescue any OpenRouter failure with one class.
  class Error < StandardError; end

  # Raised when no API key is configured. Callers guard on this to skip LLM
  # work gracefully (e.g. leave a record flagged for later scoring).
  class MissingApiKeyError < Error; end

  # Raised when the API responds with a non-success, non-retryable status, or
  # exhausts retries on a retryable status.
  class RequestError < Error; end

  # Raised when no parseable JSON can be recovered from the completion.
  class ResponseError < Error; end

  def initialize(api_key: ENV["OPENROUTER_API_KEY"], model: nil, max_retries: DEFAULT_MAX_RETRIES, http: nil)
    @api_key = api_key.to_s.strip
    @model = model.presence || ENV["OPENROUTER_MODEL"].presence || DEFAULT_MODEL
    @max_retries = max_retries
    @http = http
    raise MissingApiKeyError, "OPENROUTER_API_KEY is not configured" if @api_key.empty?
  end

  attr_reader :model

  # Request a structured JSON completion. `messages` is an array of
  # { role:, content: } hashes. Returns a parsed Ruby Hash/Array.
  #
  # Requests `response_format: json_object` (honored where the model supports
  # it) and falls back to extracting embedded JSON from the raw text otherwise.
  def complete_json(messages, temperature: 0.0)
    body = {
      model: @model,
      messages: messages,
      temperature: temperature,
      response_format: { type: "json_object" }
    }

    raw = request(body)
    content = extract_content(raw)
    parse_json(content)
  end

  private

  def request(body)
    payload = JSON.generate(body)
    attempt = 0

    loop do
      attempt += 1
      response = perform(payload)
      status = response.code.to_i

      return JSON.parse(response.body) if status.between?(200, 299)

      if RETRYABLE_STATUSES.include?(status) && attempt <= @max_retries
        log("retrying", status: status, attempt: attempt)
        sleep(backoff(attempt)) unless Rails.env.test?
        next
      end

      log("request_failed", status: status, attempt: attempt)
      raise RequestError, "OpenRouter request failed with status #{status}"
    end
  rescue Timeout::Error, IOError, SystemCallError => e
    if (attempt ||= 1) <= @max_retries
      log("retrying", reason: e.class.name, attempt: attempt)
      sleep(backoff(attempt)) unless Rails.env.test?
      attempt += 1
      retry
    end
    raise RequestError, "OpenRouter request failed: #{e.class.name}"
  end

  def perform(payload)
    uri = URI(ENDPOINT)
    request = Net::HTTP::Post.new(uri)
    request["Authorization"] = "Bearer #{@api_key}"
    request["Content-Type"] = "application/json"
    request.body = payload

    client.request(uri, request)
  end

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

  def extract_content(parsed_body)
    choices = parsed_body["choices"]
    raise ResponseError, "OpenRouter response had no choices" unless choices.is_a?(Array) && choices.any?

    message = choices.first["message"] || {}
    content = message["content"]
    raise ResponseError, "OpenRouter response had no content" if content.to_s.strip.empty?

    content
  end

  # Parse the completion as JSON. First try the whole string; if the model
  # wrapped the JSON in prose or code fences, recover the first balanced JSON
  # value (parse fallback).
  def parse_json(content)
    JSON.parse(content)
  rescue JSON::ParserError
    candidate = extract_embedded_json(content)
    raise ResponseError, "OpenRouter completion was not valid JSON" if candidate.nil?

    begin
      JSON.parse(candidate)
    rescue JSON::ParserError
      raise ResponseError, "OpenRouter completion was not valid JSON"
    end
  end

  # Scan for the first balanced { } or [ ] block, respecting strings/escapes.
  def extract_embedded_json(text)
    open_char = nil
    close_char = nil
    start = text.index(/[\[{]/)
    return nil if start.nil?

    open_char = text[start]
    close_char = open_char == "{" ? "}" : "]"
    depth = 0
    in_string = false
    escaped = false

    text[start..].each_char.with_index do |ch, i|
      if in_string
        if escaped
          escaped = false
        elsif ch == "\\"
          escaped = true
        elsif ch == '"'
          in_string = false
        end
        next
      end

      case ch
      when '"' then in_string = true
      when open_char then depth += 1
      when close_char
        depth -= 1
        return text[start, i + 1] if depth.zero?
      end
    end

    nil
  end

  def backoff(attempt)
    [ 0.5 * (2**(attempt - 1)), 5.0 ].min
  end

  # Logs non-content metadata only — never prompt or completion text (PII).
  def log(event, **fields)
    detail = fields.map { |k, v| "#{k}=#{v}" }.join(" ")
    Rails.logger.info("OpenrouterClient #{event} model=#{@model} #{detail}".strip)
  end
end
