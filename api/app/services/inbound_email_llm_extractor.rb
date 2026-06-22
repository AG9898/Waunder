# LLM fallback that extracts job postings from an inbound email the
# deterministic known-sender parsers could not handle.
#
# Consumes emails flagged `needs_llm_fallback` by InboundEmailParser (unknown
# sender, or a known sender whose body did not match the expected layout — e.g.
# a manually forwarded alert, or LinkedIn's messier real-world HTML). It asks
# the model to pull a list of postings out of the body, then materializes each
# into a JobPost via the shared JobPostMaterializer (same Company/route handling
# as the deterministic path).
#
# Guardrails mirror JobScorer:
# - All LLM access goes through OpenrouterClient; this object never touches the
#   network directly.
# - When no API key is configured, extraction is skipped gracefully (the email
#   stays flagged for later handling, no exception) so ingestion never breaks.
# - Never logs prompt or completion contents (which may include PII).
# - Idempotent: an email already extracted (`llm_parsed`) is not re-sent to the
#   model on a job retry.
class InboundEmailLlmExtractor
  STATUS_EXTRACTED = "llm_parsed".freeze
  STATUS_EMPTY = "llm_no_postings".freeze
  STATUS_SKIPPED = "llm_skipped".freeze
  STATUS_FAILED = "llm_failed".freeze

  # Cap the body sent to the model so a single large HTML alert cannot blow the
  # context window / free-tier limits.
  MAX_BODY_CHARS = 12_000

  Result = Struct.new(:job_posts, :status, keyword_init: true) do
    def extracted? = status == STATUS_EXTRACTED
  end

  def initialize(inbound_email, client: nil)
    @inbound_email = inbound_email
    @client = client
  end

  def call
    return already_extracted_result if already_extracted?

    client = @client || build_client
    return skip! if client.nil?

    payload = client.complete_json(messages)
    postings = normalize(payload)
    job_posts = postings.filter_map { |posting| JobPostMaterializer.new(posting).call }

    status = job_posts.any? ? STATUS_EXTRACTED : STATUS_EMPTY
    update_parse_result(status, job_posts: job_posts.size, needs_llm_fallback: job_posts.empty?)
    Rails.logger.info(
      "InboundEmailLlmExtractor #{status} inbound_email_id=#{inbound_email.id} job_posts=#{job_posts.size}"
    )
    Result.new(job_posts: job_posts, status: status)
  rescue OpenrouterClient::Error => e
    update_parse_result(STATUS_FAILED, job_posts: 0, needs_llm_fallback: true, error: e.class.name)
    Rails.logger.info(
      "InboundEmailLlmExtractor failed inbound_email_id=#{inbound_email.id} reason=#{e.class.name}"
    )
    Result.new(job_posts: [], status: STATUS_FAILED)
  end

  private

  attr_reader :inbound_email

  def build_client
    OpenrouterClient.new
  rescue OpenrouterClient::MissingApiKeyError
    nil
  end

  def skip!
    update_parse_result(STATUS_SKIPPED, job_posts: 0, needs_llm_fallback: true)
    Rails.logger.info("InboundEmailLlmExtractor skipped (no API key) inbound_email_id=#{inbound_email.id}")
    Result.new(job_posts: [], status: STATUS_SKIPPED)
  end

  def already_extracted?
    inbound_email.raw_payload.dig("parse_result", "status") == STATUS_EXTRACTED
  end

  def already_extracted_result
    Result.new(job_posts: [], status: STATUS_EXTRACTED)
  end

  def messages
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user_prompt }
    ]
  end

  SYSTEM_PROMPT = <<~PROMPT.freeze
    You extract job postings from the body of a job-alert email (e.g. from
    LinkedIn, Indeed, Glassdoor, or a company). Return ONLY JSON of the form:

      { "postings": [
          { "title": "...", "company": "...", "location": "...",
            "posting_url": "...", "source_url": "..." }
      ] }

    Rules:
    - One object per distinct job posting. If there are no postings, return
      { "postings": [] }.
    - "title" and "company" are required; omit a posting if you cannot determine
      both.
    - "location", "posting_url", "source_url" may be empty strings if unknown.
    - Prefer the direct/canonical job URL for "posting_url" when present.
    - Do not invent postings, companies, or URLs. Extract only what is present.
  PROMPT

  def user_prompt
    <<~PROMPT
      Subject: #{data['subject']}

      Body:
      #{body.truncate(MAX_BODY_CHARS)}
    PROMPT
  end

  def normalize(payload)
    postings = payload.is_a?(Hash) ? payload["postings"] : payload
    return [] unless postings.is_a?(Array)

    postings.filter_map do |raw|
      next unless raw.is_a?(Hash)

      {
        title: raw["title"].to_s.strip.presence,
        company: raw["company"].to_s.strip.presence,
        location: raw["location"].to_s.strip.presence,
        posting_url: raw["posting_url"].to_s.strip.presence,
        source_url: raw["source_url"].to_s.strip.presence || raw["posting_url"].to_s.strip.presence,
        source: "inbound_llm"
      }
    end
  end

  # Prefer the plain-text body; fall back to a tag-stripped HTML body.
  def body
    text = data["text"].to_s
    return text unless text.strip.empty?

    ActionView::Base.full_sanitizer.sanitize(data["html"].to_s).to_s
  end

  def data
    inbound_email.raw_payload.fetch("data", {})
  end

  # Merge onto the existing parse_result so the deterministic flag history is
  # retained; only a successful extraction clears needs_llm_fallback.
  def update_parse_result(status, **extra)
    payload = inbound_email.raw_payload.deep_dup
    payload["parse_result"] = (payload["parse_result"] || {}).merge(
      "status" => status,
      **extra.transform_keys(&:to_s)
    )
    inbound_email.update!(raw_payload: payload)
  end
end
