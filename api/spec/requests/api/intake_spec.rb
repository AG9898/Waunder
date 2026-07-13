require "rails_helper"

RSpec.describe "Api intake control", type: :request do
  include ActiveJob::TestHelper

  INTAKE_AUTH_ENV = {
    "APP_SHARED_SECRET" => "correct-passphrase",
    "SESSION_SECRET" => "session-signing-secret"
  }.freeze

  around do |example|
    original_env = INTAKE_AUTH_ENV.keys.to_h { |key| [ key, ENV[key] ] }
    original_adapter = ActiveJob::Base.queue_adapter
    INTAKE_AUTH_ENV.each { |key, value| ENV[key] = value }
    ActiveJob::Base.queue_adapter = :test
    example.run
  ensure
    clear_enqueued_jobs
    ActiveJob::Base.queue_adapter = original_adapter
    original_env.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end

  before { clear_enqueued_jobs }

  def sign_in!
    post "/api/session", params: { passphrase: "correct-passphrase" }
    expect(response).to have_http_status(:ok)
  end

  def held_email(event_id)
    InboundEmail.create!(
      provider: "resend",
      event_id: event_id,
      event_type: "email.received",
      provider_email_id: "email_#{event_id}",
      raw_payload: { "type" => "email.received", "data" => {} },
      intake_state: "held"
    )
  end

  it "requires owner authentication" do
    get "/api/intake"

    expect(response).to have_http_status(:unauthorized)
  end

  it "reports intake state and schedules maintenance at most daily" do
    sign_in!

    expect { get "/api/intake" }.to have_enqueued_job(ExpireStaleJobPostsJob).once
    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body).dig("intake", "enabled")).to be(true)

    expect { get "/api/intake" }.not_to have_enqueued_job(ExpireStaleJobPostsJob)
  end

  it "pauses intake without deleting held references" do
    sign_in!
    held_email("held_1")

    patch "/api/intake", params: { intake: { enabled: false } }

    expect(response).to have_http_status(:ok)
    expect(IntakeControl.current.reload).not_to be_enabled
    expect(JSON.parse(response.body).dig("intake", "held_count")).to eq(1)
  end

  it "resumes intake and queues every held reference" do
    sign_in!
    IntakeControl.current.pause!
    first = held_email("held_1")
    second = held_email("held_2")

    expect do
      patch "/api/intake", params: { intake: { enabled: true } }
    end.to have_enqueued_job(ParseInboundEmailJob).with(first)
      .and have_enqueued_job(ParseInboundEmailJob).with(second)

    expect(IntakeControl.current.reload).to be_enabled
    expect(JSON.parse(response.body).dig("intake", "queued_count")).to eq(2)
  end

  it "rejects ambiguous values" do
    sign_in!

    patch "/api/intake", params: { intake: { enabled: "maybe" } }

    expect(response).to have_http_status(:unprocessable_content)
  end
end
