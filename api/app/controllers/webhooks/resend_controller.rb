require "svix"

module Webhooks
  class ResendController < ApplicationController
    def inbound
      secret = ENV.fetch("RESEND_WEBHOOK_SECRET", nil)
      return unauthorized("missing_secret") if secret.blank?

      payload = request.raw_post
      event = verify_payload!(payload, secret)&.deep_stringify_keys
      return unauthorized("invalid_signature") unless event
      return unauthorized("unexpected_event") unless event["type"] == "email.received"

      inbound_email = InboundEmail.create!(
        provider: "resend",
        event_id: event.fetch("id"),
        event_type: event.fetch("type"),
        provider_email_id: event.dig("data", "email_id") || event.dig("data", "id"),
        raw_payload: event,
      )
      ParseInboundEmailJob.perform_later(inbound_email)

      Rails.logger.info(
        "Resend inbound webhook accepted event_id=#{inbound_email.event_id} inbound_email_id=#{inbound_email.id}"
      )
      render json: { status: "ok" }, status: :ok
    rescue ActiveRecord::RecordNotUnique
      Rails.logger.info("Resend inbound webhook duplicate event")
      render json: { status: "ok" }, status: :ok
    rescue KeyError, ActiveRecord::RecordInvalid => e
      Rails.logger.info("Resend inbound webhook rejected status=invalid_payload reason=#{e.class.name}")
      head :bad_request
    end

    private

    def verify_payload!(payload, secret)
      Svix::Webhook.new(secret).verify(payload, svix_headers)
    rescue StandardError => e
      Rails.logger.info("Resend inbound webhook rejected status=unauthorized reason=#{e.class.name}")
      nil
    end

    def svix_headers
      {
        "svix-id" => request.headers["svix-id"],
        "svix-timestamp" => request.headers["svix-timestamp"],
        "svix-signature" => request.headers["svix-signature"]
      }
    end

    def unauthorized(reason)
      Rails.logger.info("Resend inbound webhook rejected status=unauthorized reason=#{reason}")
      head :unauthorized
    end
  end
end
