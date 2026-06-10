class ParseInboundEmailJob < ApplicationJob
  queue_as :default

  def perform(inbound_email)
    result = InboundEmailParser.new(inbound_email).call

    Rails.logger.info(
      "Inbound email parsed inbound_email_id=#{inbound_email.id} " \
        "provider=#{inbound_email.provider} parser=#{result.parser&.source_name || 'none'} " \
        "job_posts=#{result.job_posts.size} llm_fallback=#{result.fallback?}"
    )
  end
end
