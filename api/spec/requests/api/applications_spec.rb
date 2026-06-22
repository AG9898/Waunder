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

  describe "POST /api/applications" do
    def build_job_post
      company = Company.create!(name: "Acme Corp")
      job_post = company.job_posts.create!(
        title: "Senior Backend Engineer",
        posting_url: "https://boards.greenhouse.io/acme/jobs/1"
      )
      job_post
    end

    it "creates a draft application, enqueues draft generation, and returns 201" do
      sign_in!
      job_post = build_job_post

      expect do
        post "/api/applications", params: { application: { job_post_id: job_post.id } }
      end.to change(Application, :count).by(1)
        .and have_enqueued_job(GenerateApplicationDraftJob)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body).fetch("application")
      expect(body["status"]).to eq("draft")
      app = Application.find(body["application_id"])
      expect(app.job_post).to eq(job_post)
    end

    it "reuses an existing draft application and does not duplicate" do
      sign_in!
      job_post = build_job_post
      existing = Application.create!(job_post: job_post, status: "draft")
      existing.create_application_draft!(structured_answers: [], autofill_payload: {})

      expect do
        post "/api/applications", params: { application: { job_post_id: job_post.id } }
      end.not_to change(Application, :count)

      # Draft already present, so generation is not re-enqueued.
      expect(enqueued_jobs).to be_empty
      expect(JSON.parse(response.body).dig("application", "application_id")).to eq(existing.id)
    end

    it "requires authentication" do
      job_post = build_job_post

      post "/api/applications", params: { application: { job_post_id: job_post.id } }

      expect(response).to have_http_status(:unauthorized)
      expect(enqueued_jobs).to be_empty
    end
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

    it "approves a draft on submit (single-click) and dispatches for clean supported payloads" do
      sign_in!
      app = build_application(status: "draft", approved_at: nil)

      expect do
        post "/api/applications/#{app.id}/submit"
      end.to change(AuditEvent, :count).by(1)
        .and have_enqueued_job(WorkerDispatchJob)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to include("status" => "dispatched", "ats" => "greenhouse")

      app.reload
      expect(app.status).to eq("approved")
      expect(app.approved_at).to be_present
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

  describe "GET /api/applications/:id" do
    it "returns the draft, job context, and worker-shaped autofill preview" do
      sign_in!
      app = build_application(status: "draft", approved_at: nil)
      app.application_draft.update!(
        cover_letter: "Dear Acme team, ...",
        resume_emphasis_notes: "Emphasize backend platform work.",
        structured_answers: [ { "field" => "years_experience", "value" => "7" } ]
      )

      get "/api/applications/#{app.id}"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body).fetch("application")
      expect(body).to include(
        "application_id" => app.id,
        "job_title" => "Senior Backend Engineer",
        "company" => "Acme Corp",
        "status" => "draft",
        "cover_letter" => "Dear Acme team, ...",
        "resume_emphasis_notes" => "Emphasize backend platform work."
      )
      expect(body["structured_answers"]).to eq(
        [ { "field" => "years_experience", "value" => "7" } ]
      )
      expect(body["autofill_payload"]).to include(
        "ats" => "greenhouse",
        "apply_url" => "https://boards.greenhouse.io/acme/jobs/1",
        "resume_ref" => "resume-doc-1"
      )
      expect(body["autofill_payload"]["answers"]).to eq(
        [ { "field" => "full_name", "value" => "Jane Doe" } ]
      )
    end

    it "is read-only: it does not submit or enqueue worker dispatch" do
      sign_in!
      app = build_application

      expect do
        get "/api/applications/#{app.id}"
      end.not_to change(AuditEvent, :count)

      expect(response).to have_http_status(:ok)
      expect(enqueued_jobs).to be_empty
    end

    it "returns 404 for an unknown application" do
      sign_in!

      get "/api/applications/0"

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body).dig("error", "code")).to eq("not_found")
    end

    it "requires authentication" do
      app = build_application

      get "/api/applications/#{app.id}"

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
