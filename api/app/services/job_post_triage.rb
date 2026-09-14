# Deterministically gates bulk-inbound JobPosts before any OpenRouter scoring.
#
# This keeps high-volume alert emails cheap: title and location rules decide
# whether a post is eligible for automatic scoring, deferred by the daily budget,
# or filtered into the unscored queue for manual review.
class JobPostTriage
  STATUS_UNREVIEWED = "unreviewed".freeze
  STATUS_ELIGIBLE = "eligible".freeze
  STATUS_REJECTED = "rejected".freeze
  STATUS_MANUAL_OVERRIDE = "manual_override".freeze

  SCORE_STATUS_PENDING = "pending".freeze
  SCORE_STATUS_FILTERED = "filtered".freeze
  SCORE_STATUS_DEFERRED = "deferred".freeze

  DEFAULT_AUTO_SCORE_DAILY_LIMIT = 20
  AUTO_SCORE_DAILY_LIMIT_ENV = "JOB_TRIAGE_AUTO_SCORE_DAILY_LIMIT".freeze

  LIFECYCLE_ACTIVE = "active".freeze
  LIFECYCLE_BACKLOG = "backlog".freeze

  DEFAULT_DAILY_ACTIVE_LIMIT = 30
  DAILY_ACTIVE_LIMIT_ENV = "JOB_INTAKE_DAILY_ACTIVE_LIMIT".freeze

  Result = Struct.new(:status, :score, :reasons, :remote_status, keyword_init: true) do
    def eligible? = status == STATUS_ELIGIBLE
    def rejected? = status == STATUS_REJECTED
  end

  def self.auto_score_daily_limit
    raw = ENV.fetch(AUTO_SCORE_DAILY_LIMIT_ENV, DEFAULT_AUTO_SCORE_DAILY_LIMIT).to_s.strip
    return DEFAULT_AUTO_SCORE_DAILY_LIMIT if raw.blank?

    Integer(raw, exception: false).to_i.clamp(0, 10_000)
  end

  def self.daily_active_limit
    raw = ENV.fetch(DAILY_ACTIVE_LIMIT_ENV, DEFAULT_DAILY_ACTIVE_LIMIT).to_s.strip
    return DEFAULT_DAILY_ACTIVE_LIMIT if raw.blank?

    Integer(raw, exception: false).to_i.clamp(0, 10_000)
  end

  def initialize(job_post)
    @job_post = job_post
  end

  def call
    result = evaluate
    job_post.update!(
      triage_status: result.status,
      triage_score: result.score,
      triage_reasons: result.reasons,
      triaged_at: Time.current,
      remote_status: job_post.remote_status.presence || result.remote_status
    )
    result
  end

  private

  attr_reader :job_post

  def evaluate
    title = job_post.title.to_s
    location = job_post.location.to_s
    reasons = []
    score = 0

    title_result = JobPostTitleScreen.call(title)
    if title_result.accepted?
      score += title_score(title_result.family)
      reasons << "title_matches_target_roles"
    else
      reasons << title_result.reason
    end

    location_result = classify_location(location)
    score += location_result.fetch(:score)
    reasons << location_result.fetch(:reason)

    status = if title_result.rejected? || !location_result.fetch(:acceptable)
      STATUS_REJECTED
    else
      STATUS_ELIGIBLE
    end

    Result.new(
      status: status,
      score: score.clamp(0, 100),
      reasons: reasons,
      remote_status: location_result.fetch(:remote_status)
    )
  end

  def title_score(family)
    {
      "ai_engineering" => 65,
      "software_engineering" => 60,
      "platform_operations" => 55,
      "data_engineering" => 50
    }.fetch(family, 50)
  end

  def classify_location(location)
    normalized = location.downcase

    return location_result(20, "location_unknown", true, nil) if normalized.blank?
    return location_result(35, "location_vancouver_priority", true, inferred_remote(normalized)) if normalized.include?("vancouver")
    return location_result(30, "location_calgary_priority", true, inferred_remote(normalized)) if normalized.include?("calgary")
    return location_result(25, "location_remote_priority", true, "remote") if remote?(normalized)
    return location_result(15, "location_broad_canada", true, nil) if broad_canada?(normalized)

    location_result(-30, "location_outside_priority_markets", false, inferred_remote(normalized))
  end

  def location_result(score, reason, acceptable, remote_status)
    {
      score: score,
      reason: reason,
      acceptable: acceptable,
      remote_status: remote_status
    }
  end

  def inferred_remote(normalized_location)
    return "remote" if remote?(normalized_location)
    return "hybrid" if normalized_location.include?("hybrid")
    return "onsite" if normalized_location.match?(/on[\s-]?site|in[\s-]?person/)

    nil
  end

  def remote?(normalized_location)
    normalized_location.include?("remote") || normalized_location.include?("work from home")
  end

  def broad_canada?(normalized_location)
    normalized_location.match?(/\A(?:canada|british columbia|bc|alberta|ab)(?:\s*\([^)]*\))?\z/)
  end
end
