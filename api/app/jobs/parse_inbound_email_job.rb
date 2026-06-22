class ParseInboundEmailJob < ApplicationJob
  queue_as :default

  def perform(inbound_email)
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

    # Inbound-created JobPosts must be scored just like manually-added ones; the
    # parse flow is the single ingestion point for alert email.
    job_posts.each { |job_post| ScoreJobPostJob.perform_later(job_post) }

    Rails.logger.info(
      "Inbound email parsed inbound_email_id=#{inbound_email.id} " \
        "provider=#{inbound_email.provider} parser=#{result.parser&.source_name || 'none'} " \
        "job_posts=#{job_posts.size} llm_fallback=#{result.fallback?}"
    )
  end

  private

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
