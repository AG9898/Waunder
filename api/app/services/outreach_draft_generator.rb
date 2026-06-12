# Generates an OutreachDraft for a ContactCandidate via the OpenRouter LLM.
#
# Given a ContactCandidate (which links a JobPost) and an optional loose
# template, this service drafts a short, prefilled outreach message tailored to
# the contact and the role. The draft is created for MANUAL sending only — it is
# never auto-sent anywhere (no email, no LinkedIn message, no API call beyond the
# LLM completion).
#
# Guardrails:
# - All LLM access goes through `OpenrouterClient`; this object never touches the
#   network directly and never sends the message anywhere.
# - When no API key is configured, generation is skipped gracefully (no draft is
#   created and no exception is raised).
# - Never logs prompt/completion contents or any Profile PII; only ids and status.
class OutreachDraftGenerator
  STATUS_GENERATED = "generated".freeze
  STATUS_SKIPPED = "skipped".freeze
  STATUS_FAILED = "failed".freeze

  Result = Struct.new(:status, :outreach_draft, keyword_init: true) do
    def generated? = status == STATUS_GENERATED
    def skipped? = status == STATUS_SKIPPED
    def failed? = status == STATUS_FAILED
  end

  def initialize(contact_candidate, loose_template: nil, profile: nil, client: nil)
    @contact_candidate = contact_candidate
    @loose_template = loose_template.presence
    @profile = profile || Profile.first
    @client = client
  end

  def call
    client = @client || build_client
    return skip! if client.nil?

    payload = client.complete_json(messages)
    draft = persist!(payload)
    log_generated(draft)
    Result.new(status: STATUS_GENERATED, outreach_draft: draft)
  rescue OpenrouterClient::Error => e
    log_failed(e)
    Result.new(status: STATUS_FAILED, outreach_draft: nil)
  end

  private

  attr_reader :contact_candidate, :loose_template, :profile

  def job_post
    contact_candidate.job_post
  end

  def build_client
    OpenrouterClient.new
  rescue OpenrouterClient::MissingApiKeyError
    nil
  end

  def skip!
    Rails.logger.info(
      "OutreachDraftGenerator skipped (no API key) contact_candidate_id=#{contact_candidate.id}"
    )
    Result.new(status: STATUS_SKIPPED, outreach_draft: nil)
  end

  def persist!(payload)
    message = stringify(payload["message"]).to_s.strip
    raise OpenrouterClient::ResponseError, "Outreach completion had no message" if message.empty?

    contact_candidate.outreach_drafts.create!(
      message: message,
      loose_template: loose_template
    )
  end

  def messages
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user_prompt }
    ]
  end

  def user_prompt
    fields = {
      "contact" => contact_fields,
      "job" => job_fields,
      "sender" => sender_fields,
      "loose_template" => loose_template
    }.compact

    "Draft a short outreach message and return the required JSON object.\n\n" \
      "#{JSON.pretty_generate(fields)}"
  end

  def contact_fields
    {
      "name" => contact_candidate.name,
      "title" => contact_candidate.title,
      "company" => contact_candidate.company_name,
      "relevance_reason" => contact_candidate.relevance_reason
    }.compact
  end

  def job_fields
    {
      "title" => job_post&.title,
      "company" => job_post&.company&.name,
      "summary" => job_post&.summary
    }.compact
  end

  def sender_fields
    return nil if profile.nil?

    {
      "full_name" => profile.full_name,
      "headline" => profile.headline
    }.compact
  end

  def stringify(value)
    value.is_a?(String) ? value.strip : value&.to_s
  end

  def log_generated(draft)
    Rails.logger.info(
      "OutreachDraftGenerator generated contact_candidate_id=#{contact_candidate.id} " \
        "outreach_draft_id=#{draft.id}"
    )
  end

  def log_failed(error)
    Rails.logger.warn(
      "OutreachDraftGenerator failed contact_candidate_id=#{contact_candidate.id} " \
        "error=#{error.class.name}"
    )
  end

  SYSTEM_PROMPT = <<~PROMPT.freeze
    You are an outreach-message writer for a single user's personal job search.
    Given a target contact, a job posting, the sender's identity, and an optional
    loose template, draft a short, warm, professional outreach message that the
    user will send MANUALLY. Respond ONLY with a JSON object using exactly this
    key:

    - "message": the drafted outreach message as a single string.

    Keep it concise and specific to the contact and role. Use only the provided
    data; do not fabricate shared connections or experience. Do not include any
    text outside the JSON object.
  PROMPT
end
