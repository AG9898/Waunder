# Scores a normalized JobPost against the user's profile via the OpenRouter LLM
# gateway and writes structured results back onto the JobPost.
#
# This is the single place that turns a raw posting into decision-support data:
# a short summary, a 0-100 match score, the requirements the user clearly meets,
# the ones they're missing or weak on, resume-alignment notes, a suggested
# application strategy, and any red flags. It is also the LLM fallback for
# postings the deterministic parser couldn't handle.
#
# Guardrails:
# - All LLM access goes through `OpenrouterClient`; this object never touches the
#   network directly.
# - When no API key is configured, scoring is skipped gracefully (the JobPost is
#   marked `skipped`, no exception is raised) so ingestion never breaks on a
#   missing key.
# - Never logs prompt or completion contents (which may include resume PII).
class JobScorer
  STATUS_SKIPPED = "skipped".freeze
  STATUS_SCORED = "scored".freeze
  STATUS_FAILED = "failed".freeze

  # Result of a scoring attempt. `status` mirrors the JobPost scoring_status.
  Result = Struct.new(:status, :job_post, keyword_init: true) do
    def scored? = status == STATUS_SCORED
    def skipped? = status == STATUS_SKIPPED
  end

  def initialize(job_post, client: nil)
    @job_post = job_post
    @client = client
  end

  def call
    client = @client || build_client
    return skip! if client.nil?

    payload = client.complete_json(messages)
    apply_results!(payload)
    Result.new(status: STATUS_SCORED, job_post: job_post)
  rescue OpenrouterClient::Error => e
    mark_failed!(e)
    Result.new(status: STATUS_FAILED, job_post: job_post)
  end

  private

  attr_reader :job_post

  # Returns a client, or nil when no API key is configured so the caller can
  # skip gracefully instead of raising.
  def build_client
    OpenrouterClient.new
  rescue OpenrouterClient::MissingApiKeyError
    nil
  end

  def skip!
    job_post.update!(scoring_status: STATUS_SKIPPED, scored_at: Time.current)
    Rails.logger.info("JobScorer skipped (no API key) job_post_id=#{job_post.id}")
    Result.new(status: STATUS_SKIPPED, job_post: job_post)
  end

  def apply_results!(payload)
    job_post.update!(
      summary: stringify(payload["summary"]),
      match_score: clamp_score(payload["match_score"]),
      relevant_requirements: string_list(payload["relevant_requirements"]),
      missing_requirements: string_list(payload["missing_requirements"]),
      resume_alignment_notes: stringify(payload["resume_alignment_notes"]),
      application_strategy: stringify(payload["application_strategy"]),
      red_flags: string_list(payload["red_flags"]),
      scoring_status: STATUS_SCORED,
      scored_at: Time.current
    )
    Rails.logger.info(
      "JobScorer scored job_post_id=#{job_post.id} match_score=#{job_post.match_score}"
    )
  end

  def mark_failed!(error)
    job_post.update!(scoring_status: STATUS_FAILED)
    Rails.logger.warn("JobScorer failed job_post_id=#{job_post.id} error=#{error.class.name}")
  end

  def messages
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user_prompt }
    ]
  end

  def user_prompt
    fields = {
      "title" => job_post.title,
      "company" => job_post.company&.name,
      "location" => job_post.location,
      "remote_status" => job_post.remote_status,
      "employment_type" => job_post.employment_type,
      "compensation" => job_post.compensation,
      "posting_url" => job_post.posting_url,
      "description" => job_post.description
    }.compact

    "Score this job posting and return the required JSON object.\n\n" \
      "POSTING:\n#{JSON.pretty_generate(fields)}"
  end

  # Coerce the model's match_score into a clamped integer in 0..100, matching the
  # JobPost check constraint. Returns nil when the value is unusable.
  def clamp_score(value)
    return nil if value.nil?

    score = Integer(value, exception: false) || value.to_f.round
    return nil unless score.is_a?(Integer)

    score.clamp(0, 100)
  end

  def string_list(value)
    Array(value).filter_map { |item| stringify(item).presence }
  end

  def stringify(value)
    value.is_a?(String) ? value.strip : value&.to_s
  end

  SYSTEM_PROMPT = <<~PROMPT.freeze
    You are a job-fit analyst for a single user's personal job search. Given a
    job posting, assess how well it fits a strong, experienced candidate and
    respond ONLY with a JSON object using exactly these keys:

    - "summary": a 1-3 sentence plain-language summary of the role.
    - "match_score": an integer from 0 to 100 estimating overall fit.
    - "relevant_requirements": array of strings, requirements the candidate likely meets.
    - "missing_requirements": array of strings, requirements that are missing or weak.
    - "resume_alignment_notes": a short string on how to align a resume to this role.
    - "application_strategy": a short string suggesting how to apply.
    - "red_flags": array of strings, concerns about the role or posting (may be empty).

    Do not include any text outside the JSON object.
  PROMPT
end
