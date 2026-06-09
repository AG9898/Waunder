class ParseInboundEmailJob < ApplicationJob
  queue_as :default

  def perform(inbound_email)
    Rails.logger.info(
      "Inbound email parse deferred inbound_email_id=#{inbound_email.id} provider=#{inbound_email.provider}"
    )
  end
end
