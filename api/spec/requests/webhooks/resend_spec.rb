require "rails_helper"
require "base64"
require "openssl"

RSpec.describe "Resend inbound webhook", type: :request do
  include ActiveJob::TestHelper

  WEBHOOK_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw".freeze

  around do |example|
    original = ENV["RESEND_WEBHOOK_SECRET"]
    original_queue_adapter = ActiveJob::Base.queue_adapter
    ENV["RESEND_WEBHOOK_SECRET"] = WEBHOOK_SECRET
    ActiveJob::Base.queue_adapter = :test

    example.run
  ensure
    clear_enqueued_jobs
    ActiveJob::Base.queue_adapter = original_queue_adapter

    if original.nil?
      ENV.delete("RESEND_WEBHOOK_SECRET")
    else
      ENV["RESEND_WEBHOOK_SECRET"] = original
    end
  end

  before do
    clear_enqueued_jobs
  end

  it "holds a verified email without parsing when intake is paused" do
    IntakeControl.current.pause!
    payload = inbound_payload.to_json

    expect do
      post "/webhooks/resend/inbound",
        params: payload,
        headers: signed_headers(payload).merge("Content-Type" => "application/json")
    end.to change(InboundEmail, :count).by(1)

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to eq("status" => "held")
    expect(InboundEmail.last.intake_state).to eq("held")
    expect(enqueued_jobs).to be_empty
  end

  it "persists a verified email.received payload and enqueues parsing without a session" do
    payload = inbound_payload.to_json

    expect do
      post "/webhooks/resend/inbound",
        params: payload,
        headers: signed_headers(payload).merge("Content-Type" => "application/json")
    end.to change(InboundEmail, :count).by(1)
      .and have_enqueued_job(ParseInboundEmailJob)

    expect(response).to have_http_status(:ok)

    inbound_email = InboundEmail.last
    expect(inbound_email.provider).to eq("resend")
    expect(inbound_email.event_id).to eq("msg_123")
    expect(inbound_email.event_type).to eq("email.received")
    expect(inbound_email.provider_email_id).to eq("email_123")
    expect(inbound_email.raw_payload).to include(
      "type" => "email.received",
    )
    expect(inbound_email.intake_state).to eq("queued")
  end

  it "rejects an invalid signature and does not enqueue parsing" do
    payload = inbound_payload.to_json

    expect do
      post "/webhooks/resend/inbound",
        params: payload,
        headers: signed_headers(payload).merge(
          "Content-Type" => "application/json",
          "svix-signature" => "v1,invalid",
        )
    end.not_to change(InboundEmail, :count)

    expect(response).to have_http_status(:unauthorized)
    expect(enqueued_jobs).to be_empty
  end

  it "rejects missing Svix signature headers" do
    expect do
      post "/webhooks/resend/inbound",
        params: inbound_payload.to_json,
        headers: { "Content-Type" => "application/json" }
    end.not_to change(InboundEmail, :count)

    expect(response).to have_http_status(:unauthorized)
    expect(enqueued_jobs).to be_empty
  end

  it "rejects requests when the webhook secret is not configured" do
    ENV.delete("RESEND_WEBHOOK_SECRET")
    payload = inbound_payload.to_json

    expect do
      post "/webhooks/resend/inbound",
        params: payload,
        headers: signed_headers(payload).merge("Content-Type" => "application/json")
    end.not_to change(InboundEmail, :count)

    expect(response).to have_http_status(:unauthorized)
    expect(enqueued_jobs).to be_empty
  end

  it "logs status and identifiers without email payload PII" do
    logged_lines = []
    logger = instance_spy(ActiveSupport::Logger)
    allow(logger).to receive(:info) { |message| logged_lines << message }
    allow(Rails).to receive(:logger).and_return(logger)
    payload = inbound_payload.to_json

    post "/webhooks/resend/inbound",
      params: payload,
      headers: signed_headers(payload).merge("Content-Type" => "application/json")

    expect(logged_lines.join("\n")).to include("event_id=msg_123")
    expect(logged_lines.join("\n")).not_to include("candidate@example.com")
    expect(logged_lines.join("\n")).not_to include("Forwarded job alert body")
  end

  private

  # Mirrors Resend's real email.received webhook body: no top-level "id" (the unique
  # message id arrives in the svix-id header, set to "msg_123" in signed_headers).
  def inbound_payload
    {
      type: "email.received",
      data: {
        email_id: "email_123",
        from: "candidate@example.com",
        subject: "Forwarded job alert",
        text: "Forwarded job alert body"
      }
    }
  end

  def signed_headers(payload)
    timestamp = Time.now.to_i.to_s
    message_id = "msg_123"

    {
      "svix-id" => message_id,
      "svix-timestamp" => timestamp,
      "svix-signature" => "v1,#{signature_for(message_id, timestamp, payload)}"
    }
  end

  def signature_for(message_id, timestamp, payload)
    secret = Base64.decode64(WEBHOOK_SECRET.delete_prefix("whsec_"))
    signed_content = "#{message_id}.#{timestamp}.#{payload}"
    Base64.strict_encode64(OpenSSL::HMAC.digest("SHA256", secret, signed_content))
  end
end
