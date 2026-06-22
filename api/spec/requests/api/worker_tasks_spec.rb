require "rails_helper"

RSpec.describe "Api worker tasks", type: :request do
  WORKER_TASKS_AUTH_ENV = {
    "APP_SHARED_SECRET" => "correct-passphrase",
    "SESSION_SECRET" => "session-signing-secret",
    "WORKER_SERVICE_TOKEN" => "worker-service-token"
  }.freeze

  around do |example|
    original_env = WORKER_TASKS_AUTH_ENV.keys.to_h { |key| [ key, ENV[key] ] }
    WORKER_TASKS_AUTH_ENV.each { |key, value| ENV[key] = value }

    example.run
  ensure
    original_env.each do |key, value|
      value.nil? ? ENV.delete(key) : ENV[key] = value
    end
  end

  def worker_headers(token = "worker-service-token")
    { "Authorization" => "Bearer #{token}" }
  end

  def sign_in!
    post "/api/session", params: { passphrase: "correct-passphrase" }
    expect(response).to have_http_status(:ok)
  end

  def build_dispatched_application
    company = Company.create!(name: "Acme Corp")
    job_post = company.job_posts.create!(
      title: "Senior Backend Engineer",
      posting_url: "https://boards.greenhouse.io/acme/jobs/1"
    )
    application = Application.create!(
      job_post: job_post,
      status: "approved",
      approved_at: Time.current
    )
    application.create_application_draft!(
      structured_answers: [],
      autofill_payload: {
        "application_id" => application.id,
        "ats" => "greenhouse",
        "apply_url" => "https://boards.greenhouse.io/acme/jobs/1",
        "answers" => [
          { "field" => "full_name", "value" => "Jane Doe" },
          { "field" => "email", "value" => "jane@example.com" }
        ],
        "resume_ref" => "resume-doc-1"
      }
    )
    application.audit_events.create!(
      event_type: "submit_dispatched",
      status: application.status,
      metadata: { "ats" => "greenhouse" }
    )
    application
  end

  describe "GET /api/worker_tasks" do
    it "returns approved dispatched tasks with a valid worker bearer token" do
      application = build_dispatched_application

      get "/api/worker_tasks", headers: worker_headers

      expect(response).to have_http_status(:ok)
      task = JSON.parse(response.body).fetch("tasks").sole
      expect(task).to include(
        "applicationId" => application.id.to_s,
        "ats" => "greenhouse",
        "applyUrl" => "https://boards.greenhouse.io/acme/jobs/1",
        "resumeRef" => "resume-doc-1"
      )
      expect(task["answers"]).to contain_exactly(
        { "field" => "full_name", "value" => "Jane Doe" },
        { "field" => "email", "value" => "jane@example.com" }
      )
    end

    it "rejects a missing or invalid bearer token" do
      get "/api/worker_tasks"
      expect(response).to have_http_status(:unauthorized)

      get "/api/worker_tasks", headers: worker_headers("wrong-token")
      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects the human session cookie without the worker bearer token" do
      sign_in!

      get "/api/worker_tasks"

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "POST /api/worker_tasks/:id/report" do
    it "updates application status and stores audit artifacts" do
      application = build_dispatched_application

      expect do
        post "/api/worker_tasks/#{application.id}/report",
             params: {
               status: "paused",
               reason: "manual review required",
               screenshots: [ "s3://audit/screen-1.png" ],
               logs: [ "opened form", "paused on unknown field" ],
               metadata: { "attempt" => 1 }
             },
             headers: worker_headers
      end.to change(AuditEvent, :count).by(1)

      expect(response).to have_http_status(:ok)
      application.reload
      expect(application.status).to eq("paused")
      expect(application.failure_reason).to eq("manual review required")

      event = application.audit_events.order(:created_at).last
      expect(event.event_type).to eq("worker_status_reported")
      expect(event.status).to eq("paused")
      expect(event.reason).to eq("manual review required")
      expect(event.screenshots).to eq([ "s3://audit/screen-1.png" ])
      expect(event.logs).to eq([ "opened form", "paused on unknown field" ])
      expect(event.metadata).to eq("attempt" => "1")
    end

    it "records submitted status with submitted_at and clears failure reason" do
      application = build_dispatched_application
      application.update!(failure_reason: "previous pause")

      post "/api/worker_tasks/#{application.id}/report",
           params: { status: "submitted", screenshots: [], logs: [] },
           headers: worker_headers

      expect(response).to have_http_status(:ok)
      application.reload
      expect(application.status).to eq("submitted")
      expect(application.submitted_at).to be_present
      expect(application.failure_reason).to be_nil
      expect(application.pipeline_status).to eq("applied")
      expect(application.pipeline_stage).to eq("waiting")
    end

    it "marks failed or paused worker outcomes as needing review in the tracker" do
      application = build_dispatched_application

      post "/api/worker_tasks/#{application.id}/report",
           params: { status: "failed", reason: "browser launch failed", screenshots: [], logs: [] },
           headers: worker_headers

      expect(response).to have_http_status(:ok)
      application.reload
      expect(application.status).to eq("failed")
      expect(application.pipeline_status).to eq("needs_review")
      expect(application.failure_reason).to eq("browser launch failed")
    end

    it "rejects a human session cookie without a worker bearer token" do
      application = build_dispatched_application
      sign_in!

      post "/api/worker_tasks/#{application.id}/report", params: { status: "failed" }

      expect(response).to have_http_status(:unauthorized)
      expect(application.reload.status).to eq("approved")
    end
  end
end
