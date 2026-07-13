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

      # Resend's email.received payload has no top-level "id"; the unique, retry-stable
      # identifier is the Svix message id from the svix-id header (guaranteed present once
      # verify_payload! succeeds). Using it as event_id makes Svix redeliveries idempotent.
      event_id = request.headers["svix-id"]
      return unauthorized("missing_message_id") if event_id.blank?

      intake_enabled = IntakeControl.current.enabled?
      inbound_email = InboundEmail.create!(
        provider: "resend",
        event_id: event_id,
        event_type: event.fetch("type"),
        provider_email_id: event.dig("data", "email_id") || event.dig("data", "id"),
        raw_payload: event,
        intake_state: intake_enabled ? "queued" : "held",
      )
      ParseInboundEmailJob.perform_later(inbound_email) if intake_enabled

      Rails.logger.info(
        "Resend inbound webhook accepted event_id=#{inbound_email.event_id} " \
          "inbound_email_id=#{inbound_email.id} intake_state=#{inbound_email.intake_state}"
      )
      render json: { status: intake_enabled ? "ok" : "held" }, status: :ok
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
