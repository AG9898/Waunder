require "rails_helper"

RSpec.describe "Api applications", type: :request do
  include ActiveJob::TestHelper

  APPLICATIONS_AUTH_ENV = {
    "APP_SHARED_SECRET" => "correct-passphrase",
    "SESSION_SECRET" => "session-signing-secret",
    "WORKER_SERVICE_TOKEN" => "worker-service-token"
  }.freeze

  around do |example|
    original_env = APPLICATIONS_AUTH_ENV.keys.to_h { |key| [ key, ENV[key] ] }
    original_queue_adapter = ActiveJob::Base.queue_adapter
    APPLICATIONS_AUTH_ENV.each { |key, value| ENV[key] = value }
    ActiveJob::Base.queue_adapter = :test

    example.run
  ensure
    clear_enqueued_jobs
    ActiveJob::Base.queue_adapter = original_queue_adapter
    original_env.each do |key, value|
      value.nil? ? ENV.delete(key) : ENV[key] = value
    end
  end

  before do
    clear_enqueued_jobs
  end

  def sign_in!
    post "/api/session", params: { passphrase: "correct-passphrase" }
    expect(response).to have_http_status(:ok)
  end

  def build_application(status: "approved", approved_at: Time.current, ats: "greenhouse", answers: nil)
    company = Company.create!(name: "Acme Corp")
    job_post = company.job_posts.create!(
      title: "Senior Backend Engineer",
      posting_url: "https://boards.greenhouse.io/acme/jobs/1"
    )
    job_post.create_application_route!(
      route_type: ats == "manual" ? "unknown" : ats,
      recommended_route: ats == "manual" ? "manual" : "direct_ats",
      route_confidence: 0.99,
      application_url: "https://boards.greenhouse.io/acme/jobs/1"
    )
    app = Application.create!(job_post: job_post, status: status, approved_at: approved_at)
    app.create_application_draft!(
      structured_answers: [],
      autofill_payload: {
        "application_id" => app.id,
        "ats" => ats,
        "apply_url" => "https://boards.greenhouse.io/acme/jobs/1",
        "answers" => answers || [ { "field" => "full_name", "value" => "Jane Doe" } ],
        "resume_ref" => "resume-doc-1"
      }
    )
    app
  end

  describe "POST /api/applications/:id/submit" do
    it "enqueues worker dispatch, records an audit event, and returns 200 for approved clean payloads" do
      sign_in!
      app = build_application

      expect do
        post "/api/applications/#{app.id}/submit"
      end.to change(AuditEvent, :count).by(1)
        .and have_enqueued_job(WorkerDispatchJob)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to include(
        "status" => "dispatched",
        "application_id" => app.id,
        "ats" => "greenhouse"
      )

      event = app.audit_events.sole
      expect(event.event_type).to eq("submit_dispatched")
      expect(event.status).to eq("approved")
      expect(event.metadata["ats"]).to eq("greenhouse")
    end

    it "rejects submit without approval and does not enqueue" do
      sign_in!
      app = build_application(status: "draft", approved_at: nil)

      expect do
        post "/api/applications/#{app.id}/submit"
      end.not_to change(AuditEvent, :count)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body).dig("error", "code")).to eq("approval_required")
      expect(enqueued_jobs).to be_empty
    end

    it "rejects unsupported ATS targets and does not enqueue" do
      sign_in!
      app = build_application(ats: "manual")

      expect do
        post "/api/applications/#{app.id}/submit"
      end.not_to change(AuditEvent, :count)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body).dig("error", "code")).to eq("unsupported_ats")
      expect(enqueued_jobs).to be_empty
    end

    it "rejects unresolved or sensitive payload fields and does not enqueue" do
      sign_in!
      app = build_application(answers: [ { "field" => "salary expectation", "value" => "open" } ])

      expect do
        post "/api/applications/#{app.id}/submit"
      end.not_to change(AuditEvent, :count)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body).dig("error", "code")).to eq("unsafe_payload")
      expect(enqueued_jobs).to be_empty
    end

    it "requires authentication" do
      app = build_application

      post "/api/applications/#{app.id}/submit"

      expect(response).to have_http_status(:unauthorized)
      expect(enqueued_jobs).to be_empty
    end
  end
end
