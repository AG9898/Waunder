# Generates an ApplicationDraft for an Application's JobPost + Profile.
#
# Given an Application (which links a JobPost) and the user's Profile, this
# service produces, via the OpenRouter LLM gateway:
# - resume_emphasis_notes: tailored notes on what to emphasize from the resume
# - cover_letter: a drafted cover letter
# - message: a short outreach/application message draft
# - structured_answers: an array of { "question", "answer" } pairs for common
#   application questions
# - autofill_payload: a structured payload keyed to the resolved route's ATS
#   shape, ready for an (approved) worker submit task
#
# It reuses encrypted Profile / ResumeDocument data to ground the draft and is
# the single place that turns a scored posting into application materials.
#
# Guardrails:
# - All LLM access goes through `OpenrouterClient`; this object never touches the
#   network directly.
# - When no API key is configured, generation is skipped gracefully (no draft is
#   created and no exception is raised) so the pipeline never breaks on a missing
#   key.
# - Never logs prompt or completion contents, nor any Profile/ResumeDocument PII.
#   Only non-content metadata (ids, status, ats) is logged.
# - The autofill payload never invents sensitive-field answers (legal,
#   demographic, salary, disability, sponsorship, identity); those are left for
#   explicit user input. Only known profile-derived fields are filled.
class ApplicationDraftGenerator
  STATUS_GENERATED = "generated".freeze
  STATUS_SKIPPED = "skipped".freeze
  STATUS_FAILED = "failed".freeze

  # ATS shapes the autofill payload can target. Mirrors the worker's AtsKind and
  # the deterministic route_type values. Anything else falls back to "manual".
  ATS_BY_ROUTE_TYPE = {
    "greenhouse" => "greenhouse",
    "lever" => "lever",
    "ashby" => "ashby",
    "linkedin_easy_apply" => "linkedin_easy_apply"
  }.freeze

  Result = Struct.new(:status, :application_draft, keyword_init: true) do
    def generated? = status == STATUS_GENERATED
    def skipped? = status == STATUS_SKIPPED
    def failed? = status == STATUS_FAILED
  end

  def initialize(application, profile: nil, client: nil)
    @application = application
    @profile = profile || Profile.first
    @client = client
  end

  def call
    client = @client || build_client
    return skip! if client.nil?

    payload = client.complete_json(messages)
    draft = persist!(payload)
    log_generated(draft)
    Result.new(status: STATUS_GENERATED, application_draft: draft)
  rescue OpenrouterClient::Error => e
    log_failed(e)
    Result.new(status: STATUS_FAILED, application_draft: nil)
  end

  private

  attr_reader :application, :profile

  def job_post
    application.job_post
  end

  def route
    job_post&.application_route
  end

  # Returns a client, or nil when no API key is configured so the caller can
  # skip gracefully instead of raising.
  def build_client
    OpenrouterClient.new
  rescue OpenrouterClient::MissingApiKeyError
    nil
  end

  def skip!
    Rails.logger.info("ApplicationDraftGenerator skipped (no API key) application_id=#{application.id}")
    Result.new(status: STATUS_SKIPPED, application_draft: nil)
  end

  def persist!(payload)
    draft = application.application_draft || application.build_application_draft
    draft.assign_attributes(
      resume_emphasis_notes: stringify(payload["resume_emphasis_notes"]),
      cover_letter: stringify(payload["cover_letter"]),
      message: stringify(payload["message"]),
      structured_answers: structured_answers(payload["structured_answers"]),
      autofill_payload: autofill_payload(payload["structured_answers"])
    )
    draft.save!
    draft
  end

  # Normalize the model's structured answers into an array of
  # { "question", "answer" } string hashes, dropping anything malformed.
  def structured_answers(value)
    Array(value).filter_map do |item|
      next unless item.is_a?(Hash)

      question = stringify(item["question"]).to_s.strip
      answer = stringify(item["answer"]).to_s.strip
      next if question.empty? || answer.empty?

      { "question" => question, "answer" => answer }
    end
  end

  # Build a worker-shaped autofill payload keyed to the resolved route's ATS.
  # The answers combine deterministic profile-derived fields (name, email, etc.)
  # with the model's structured answers. This never includes sensitive fields.
  def autofill_payload(model_answers)
    {
      "application_id" => application.id,
      "ats" => ats_kind,
      "apply_url" => apply_url,
      "answers" => answer_fields(model_answers),
      "resume_ref" => resume_ref
    }.compact
  end

  # Maps the resolved route_type to a worker ATS kind, or "manual" when the
  # route is unknown / not a directly automatable ATS.
  def ats_kind
    ATS_BY_ROUTE_TYPE.fetch(route&.route_type, "manual")
  end

  def apply_url
    route&.application_url.presence || job_post&.posting_url.presence
  end

  # Deterministic, non-sensitive field answers drawn from the profile, merged
  # with the model's structured answers. Each entry is { "field", "value" }.
  def answer_fields(model_answers)
    fields = profile_fields
    Array(model_answers).each do |item|
      next unless item.is_a?(Hash)

      field = stringify(item["question"]).to_s.strip
      value = stringify(item["answer"]).to_s.strip
      next if field.empty? || value.empty?

      fields << { "field" => field, "value" => value }
    end
    fields
  end

  # Known, non-sensitive profile fields the worker can safely autofill.
  def profile_fields
    return [] if profile.nil?

    {
      "full_name" => profile.full_name,
      "email" => profile.email,
      "phone" => profile.phone,
      "location" => profile.location,
      "linkedin_url" => profile.linkedin_url,
      "github_url" => profile.github_url,
      "portfolio_url" => profile.portfolio_url
    }.filter_map do |field, value|
      next if value.blank?

      { "field" => field, "value" => value.to_s }
    end
  end

  def resume_ref
    doc = primary_resume_document
    doc&.storage_key.presence
  end

  def primary_resume_document
    return nil if profile.nil?

    docs = profile.resume_documents
    docs.detect(&:primary) || docs.first
  end

  def messages
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user_prompt }
    ]
  end

  def user_prompt
    fields = {
      "job" => job_fields,
      "candidate" => candidate_fields,
      "resume" => resume_fields
    }.compact

    "Draft application materials for this candidate and posting and return the " \
      "required JSON object.\n\n#{JSON.pretty_generate(fields)}"
  end

  def job_fields
    {
      "title" => job_post&.title,
      "company" => job_post&.company&.name,
      "location" => job_post&.location,
      "description" => job_post&.description,
      "summary" => job_post&.summary,
      "relevant_requirements" => job_post&.relevant_requirements,
      "missing_requirements" => job_post&.missing_requirements,
      "resume_alignment_notes" => job_post&.resume_alignment_notes
    }.compact
  end

  def candidate_fields
    return nil if profile.nil?

    {
      "full_name" => profile.full_name,
      "headline" => profile.headline,
      "summary" => profile.summary,
      "skills" => profile.skills,
      "work_history" => profile.work_history,
      "education" => profile.education
    }.compact
  end

  def resume_fields
    doc = primary_resume_document
    return nil if doc.nil?

    { "title" => doc.title, "raw_text" => doc.raw_text }.compact
  end

  def stringify(value)
    value.is_a?(String) ? value.strip : value&.to_s
  end

  def log_generated(draft)
    Rails.logger.info(
      "ApplicationDraftGenerator generated application_id=#{application.id} " \
        "draft_id=#{draft.id} ats=#{ats_kind}"
    )
  end

  def log_failed(error)
    Rails.logger.warn(
      "ApplicationDraftGenerator failed application_id=#{application.id} error=#{error.class.name}"
    )
  end

  SYSTEM_PROMPT = <<~PROMPT.freeze
    You are an application-materials writer for a single user's personal job
    search. Given a job posting and the candidate's profile/resume, draft
    tailored application materials and respond ONLY with a JSON object using
    exactly these keys:

    - "resume_emphasis_notes": a short string on what resume points to emphasize.
    - "cover_letter": a tailored cover letter as a single string.
    - "message": a short application/outreach message draft as a single string.
    - "structured_answers": an array of objects, each with "question" and
      "answer" string keys, for common non-sensitive application questions
      (e.g. years of experience, why this role, notice period). Do NOT answer
      legal, demographic, salary, disability, sponsorship, or identity questions;
      omit them entirely.

    Use only the provided candidate data. Do not fabricate experience. Do not
    include any text outside the JSON object.
  PROMPT
end
