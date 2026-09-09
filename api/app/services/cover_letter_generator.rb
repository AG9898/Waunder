# Generates the one current, owner-requested CoverLetterDraft for a JobPost.
#
# It is intentionally separate from ApplicationDraftGenerator: a cover letter
# is useful for manual applications and must never create an Application,
# enqueue a worker task, or advance an application status.
class CoverLetterGenerator
  STATUS_GENERATED = "generated".freeze
  STATUS_SKIPPED = "skipped".freeze
  STATUS_FAILED = "failed".freeze

  Result = Struct.new(:status, :cover_letter_draft, keyword_init: true) do
    def generated? = status == STATUS_GENERATED
    def skipped? = status == STATUS_SKIPPED
    def failed? = status == STATUS_FAILED
  end

  def initialize(job_post, profile: nil, client: nil)
    @job_post = job_post
    @profile = profile || Profile.first
    @client = client
  end

  def call
    client = @client || build_client
    return skip! if client.nil?

    draft = persist!(client.complete_json(messages))
    log_generated(draft)
    Result.new(status: STATUS_GENERATED, cover_letter_draft: draft)
  rescue OpenrouterClient::Error => e
    log_failed(e)
    Result.new(status: STATUS_FAILED, cover_letter_draft: nil)
  end

  private

  attr_reader :job_post, :profile

  def build_client
    OpenrouterClient.new
  rescue OpenrouterClient::MissingApiKeyError
    nil
  end

  def skip!
    Rails.logger.info("CoverLetterGenerator skipped (no API key) job_post_id=#{job_post.id}")
    Result.new(status: STATUS_SKIPPED, cover_letter_draft: nil)
  end

  def persist!(payload)
    body = stringify(payload["cover_letter"]).to_s.strip
    raise OpenrouterClient::ResponseError, "Cover letter completion had no cover_letter" if body.empty?

    draft = job_post.cover_letter_draft || job_post.build_cover_letter_draft
    draft.assign_attributes(body: body, generated_at: Time.current)
    draft.save!
    draft
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

    "Draft a cover letter for this candidate and posting and return the required JSON object.\n\n" \
      "#{JSON.pretty_generate(fields)}"
  end

  def job_fields
    {
      "title" => job_post.title,
      "company" => job_post.company&.name,
      "location" => job_post.location,
      "description" => job_post.description,
      "summary" => job_post.summary,
      "relevant_requirements" => job_post.relevant_requirements,
      "missing_requirements" => job_post.missing_requirements,
      "resume_alignment_notes" => job_post.resume_alignment_notes
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
    document = primary_resume_document
    return nil if document.nil?

    { "title" => document.title, "raw_text" => document.raw_text }.compact
  end

  def primary_resume_document
    return nil if profile.nil?

    documents = profile.resume_documents
    documents.detect(&:primary) || documents.first
  end

  def stringify(value)
    value.is_a?(String) ? value.strip : value&.to_s
  end

  def log_generated(draft)
    Rails.logger.info("CoverLetterGenerator generated job_post_id=#{job_post.id} draft_id=#{draft.id}")
  end

  def log_failed(error)
    Rails.logger.warn("CoverLetterGenerator failed job_post_id=#{job_post.id} error=#{error.class.name}")
  end

  SYSTEM_PROMPT = <<~PROMPT.freeze
    You are a cover-letter writer for a single user's personal job search.
    Given a job posting and the candidate's profile/resume, write a concise,
    specific cover letter (roughly 250–350 words) and respond ONLY with a JSON
    object using exactly this key:

    - "cover_letter": the complete cover letter as a single string.

    Use only the provided candidate data. Do not fabricate experience,
    credentials, achievements, or shared connections. Do not include text
    outside the JSON object.
  PROMPT
end
