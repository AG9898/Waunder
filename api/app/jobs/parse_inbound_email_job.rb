class ParseInboundEmailJob < ApplicationJob
  queue_as :default

  def perform(inbound_email)
    return unless claim_for_processing!(inbound_email)

    hydrate_body!(inbound_email)

    result = InboundEmailParser.new(inbound_email).call
    job_posts = result.job_posts

    # The Resend webhook delivers only metadata, and real-world alerts (forwards,
    # LinkedIn's messy HTML, unknown boards) often don't match a deterministic
    # parser. When parsing yields nothing, fall back to LLM extraction so the
    # posting still becomes a JobPost instead of dead-ending on the flag.
    if result.fallback?
      job_posts = InboundEmailLlmExtractor.new(inbound_email).call.job_posts
    end

    triaged = job_posts.map { |job_post| triage_and_maybe_score(job_post) }

    Rails.logger.info(
      "Inbound email parsed inbound_email_id=#{inbound_email.id} " \
        "provider=#{inbound_email.provider} parser=#{result.parser&.source_name || 'none'} " \
        "job_posts=#{job_posts.size} scored=#{triaged.count { |status| status == :scored }} " \
        "filtered=#{triaged.count { |status| status == :filtered }} " \
        "deferred=#{triaged.count { |status| status == :deferred }} " \
        "llm_fallback=#{result.fallback?}"
    )
    inbound_email.update!(intake_state: "processed")
  rescue StandardError
    inbound_email.update!(intake_state: "failed") if inbound_email&.persisted?
    raise
  end

  private

  def claim_for_processing!(inbound_email)
    inbound_email.with_lock do
      return false if %w[processing processed].include?(inbound_email.intake_state)

      unless IntakeControl.current.enabled?
        inbound_email.update!(intake_state: "held")
        return false
      end

      inbound_email.update!(intake_state: "processing")
      true
    end
  end

  def triage_and_maybe_score(job_post)
    return :already_scored if job_post.scoring_status == JobScorer::STATUS_SCORED

    result = JobPostTriage.new(job_post).call
    unless result.eligible?
      # Rejected inbound posts are kept (not deleted) but pushed off the active
      # feed into the backlog so the owner can still find them on demand.
      job_post.update!(
        scoring_status: JobPostTriage::SCORE_STATUS_FILTERED,
        lifecycle_state: JobPostTriage::LIFECYCLE_BACKLOG
      )
      return :filtered
    end

    # Keep the Active feed drainable: only the first N eligible inbound posts per
    # day stay active; the rest auto-backlog (still scored/deferred as usual).
    unless active_slot_available?(excluding: job_post)
      job_post.update!(lifecycle_state: JobPostTriage::LIFECYCLE_BACKLOG)
    end

    if auto_score_budget_available?(excluding: job_post)
      job_post.update!(scoring_status: JobPostTriage::SCORE_STATUS_PENDING)
      ScoreJobPostJob.perform_later(job_post)
      :scored
    else
      job_post.update!(scoring_status: JobPostTriage::SCORE_STATUS_DEFERRED)
      :deferred
    end
  end

  def active_slot_available?(excluding:)
    JobPostTriage.daily_active_limit > active_inbound_today(excluding: excluding)
  end

  def active_inbound_today(excluding:)
    JobPost
      .where(created_at: Time.current.all_day)
      .where.not(id: excluding.id)
      .where.not(source: "manual")
      .where(triage_status: JobPostTriage::STATUS_ELIGIBLE)
      .where(lifecycle_state: JobPostTriage::LIFECYCLE_ACTIVE)
      .count
  end

  def auto_score_budget_available?(excluding:)
    JobPostTriage.auto_score_daily_limit > auto_scores_today(excluding: excluding)
  end

  def auto_scores_today(excluding:)
    JobPost
      .where(created_at: Time.current.all_day)
      .where.not(id: excluding.id)
      .where.not(source: "manual")
      .where(triage_status: JobPostTriage::STATUS_ELIGIBLE)
      .where(scoring_status: [
        JobPostTriage::SCORE_STATUS_PENDING,
        JobScorer::STATUS_SCORED,
        JobScorer::STATUS_SKIPPED,
        JobScorer::STATUS_FAILED
      ])
      .count
  end

  # Resend's `email.received` webhook payload carries no body — only metadata.
  # Pull the text/html from Resend's receiving API and merge it onto the stored
  # payload so the parsers/LLM have content to work with. Skips gracefully when
  # the body is already present (e.g. specs, or a future webhook that includes
  # it) or when no RESEND_API_KEY is configured.
  def hydrate_body!(inbound_email)
    data = inbound_email.raw_payload.fetch("data", {})
    return if data["text"].present? || data["html"].present?

    email_id = data["email_id"].presence || inbound_email.provider_email_id.presence
    return if email_id.blank?

    fetched = ResendInboundClient.new.fetch(email_id)
    payload = inbound_email.raw_payload.deep_dup
    payload["data"] = (payload["data"] || {}).merge(
      "text" => fetched["text"],
      "html" => fetched["html"]
    )
    inbound_email.update!(raw_payload: payload)
  rescue ResendInboundClient::MissingApiKeyError
    Rails.logger.info("ParseInboundEmailJob body hydration skipped (no RESEND_API_KEY) inbound_email_id=#{inbound_email.id}")
  rescue ResendInboundClient::Error => e
    Rails.logger.info("ParseInboundEmailJob body hydration failed inbound_email_id=#{inbound_email.id} reason=#{e.class.name}")
  end
end
