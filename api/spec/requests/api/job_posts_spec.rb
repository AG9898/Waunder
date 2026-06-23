require "rails_helper"

RSpec.describe "Api job posts", type: :request do
  include ActiveJob::TestHelper

  JOB_POSTS_AUTH_ENV = {
    "APP_SHARED_SECRET" => "correct-passphrase",
    "SESSION_SECRET" => "session-signing-secret",
    "WORKER_SERVICE_TOKEN" => "worker-service-token"
  }.freeze

  around do |example|
    original_env = JOB_POSTS_AUTH_ENV.keys.to_h { |key| [ key, ENV[key] ] }
    original_queue_adapter = ActiveJob::Base.queue_adapter
    JOB_POSTS_AUTH_ENV.each { |key, value| ENV[key] = value }
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

  describe "POST /api/job_posts" do
    it "creates a normalized manual JobPost, resolves its route, and enqueues scoring" do
      sign_in!

      expect do
        post "/api/job_posts", params: {
          job_post: {
            url: "https://jobs.lever.co/acme/abc-123",
            text: "Senior Platform Engineer\nBuild Rails APIs.",
            company: "Acme"
          }
        }
      end.to change(JobPost, :count).by(1)
        .and change(ApplicationRoute, :count).by(1)
        .and have_enqueued_job(ScoreJobPostJob)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      post = JobPost.last

      expect(body.dig("job_post", "id")).to eq(post.id)
      expect(body.dig("job_post", "title")).to eq("Senior Platform Engineer")
      expect(body.dig("job_post", "company")).to eq("Acme")
      expect(body.dig("job_post", "source")).to eq("manual")
      expect(body.dig("job_post", "route", "route_type")).to eq("lever")
      expect(post.description).to include("Build Rails APIs.")
      expect(post.scoring_status).to eq("pending")
    end

    it "requires authentication" do
      post "/api/job_posts", params: { job_post: { url: "https://jobs.lever.co/acme/abc-123" } }

      expect(response).to have_http_status(:unauthorized)
      expect(JSON.parse(response.body)).to eq(
        "error" => {
          "code" => "unauthorized",
          "message" => "Unauthorized"
        }
      )
      expect(enqueued_jobs).to be_empty
    end

    it "returns the consistent JSON error shape for blank input" do
      sign_in!

      expect do
        post "/api/job_posts", params: { job_post: { url: "", text: "" } }
      end.not_to change(JobPost, :count)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)).to eq(
        "error" => {
          "code" => "invalid_input",
          "message" => "Provide a URL or pasted job text"
        }
      )
      expect(enqueued_jobs).to be_empty
    end

    it "returns the consistent JSON error shape for invalid URLs" do
      sign_in!

      post "/api/job_posts", params: { job_post: { url: "ftp://example.com/job" } }

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body).dig("error", "code")).to eq("invalid_input")
      expect(enqueued_jobs).to be_empty
    end
  end

  describe "GET /api/job_posts" do
    it "returns the scored feed ranked by match score by default" do
      sign_in!
      company = Company.create!(name: "Acme")
      JobPost.create!(company: company, title: "Lower", match_score: 40,
        scoring_status: "scored", summary: "lower match")
      JobPost.create!(company: company, title: "Higher", match_score: 90,
        scoring_status: "scored", summary: "higher match")
      JobPost.create!(company: company, title: "Filtered", scoring_status: "filtered",
        triage_status: "rejected", triage_score: 20)

      get "/api/job_posts"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      titles = body["job_posts"].map { |jp| jp["title"] }
      expect(titles).to eq(%w[Higher Lower])
      first = body["job_posts"].first
      expect(first).to include(
        "title" => "Higher",
        "company" => "Acme",
        "match_score" => 90,
        "scoring_status" => "scored",
        "triage_status" => "unreviewed",
        "summary" => "higher match"
      )
    end

    it "returns unscored jobs when requested" do
      sign_in!
      company = Company.create!(name: "Acme")
      JobPost.create!(company: company, title: "Scored", match_score: 90, scoring_status: "scored")
      filtered = JobPost.create!(company: company, title: "CAD Technician", scoring_status: "filtered",
        triage_status: "rejected", triage_score: 10, triage_reasons: [ "title_missing_target_role" ])
      deferred = JobPost.create!(company: company, title: "Backend Developer", scoring_status: "deferred",
        triage_status: "eligible", triage_score: 90, triage_reasons: [ "location_calgary_priority" ])

      get "/api/job_posts", params: { status: "unscored" }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["job_posts"].map { |jp| jp["id"] }).to contain_exactly(filtered.id, deferred.id)
      expect(body["job_posts"].first).to include("triage_reasons")
    end

    it "requires authentication" do
      get "/api/job_posts"

      expect(response).to have_http_status(:unauthorized)
      expect(JSON.parse(response.body)).to eq(
        "error" => { "code" => "unauthorized", "message" => "Unauthorized" }
      )
    end
  end

  describe "POST /api/job_posts/:id/score" do
    it "enqueues scoring for a filtered job and records a manual override" do
      sign_in!
      company = Company.create!(name: "Acme")
      job_post = JobPost.create!(
        company: company,
        title: "Backend Developer",
        scoring_status: "filtered",
        triage_status: "rejected",
        triage_score: 45,
        triage_reasons: [ "location_outside_priority_markets" ]
      )

      expect do
        post "/api/job_posts/#{job_post.id}/score"
      end.to have_enqueued_job(ScoreJobPostJob).with(job_post)

      expect(response).to have_http_status(:accepted)
      job_post.reload
      expect(job_post.scoring_status).to eq("pending")
      expect(job_post.triage_status).to eq("manual_override")
      expect(job_post.triage_reasons).to include("manual_score_requested")
    end

    it "does not enqueue duplicate scoring for an already pending job" do
      sign_in!
      company = Company.create!(name: "Acme")
      job_post = JobPost.create!(company: company, title: "Backend Developer", scoring_status: "pending")

      expect do
        post "/api/job_posts/#{job_post.id}/score"
      end.not_to have_enqueued_job(ScoreJobPostJob)

      expect(response).to have_http_status(:accepted)
    end
  end

  describe "GET /api/job_posts/:id" do
    it "returns the scored detail with the resolved route" do
      sign_in!
      company = Company.create!(name: "Acme")
      job_post = JobPost.create!(
        company: company, title: "Staff Engineer", posting_url: "https://example.com/job",
        match_score: 88, scoring_status: "scored", summary: "great fit",
        relevant_requirements: [ "Go" ], missing_requirements: [ "K8s" ],
        red_flags: [ "on-call" ], resume_alignment_notes: "strong overlap",
        application_strategy: "apply direct"
      )
      ApplicationRoute.create!(job_post: job_post, route_type: "greenhouse",
        recommended_route: "direct_ats", application_url: "https://boards.greenhouse.io/acme")

      get "/api/job_posts/#{job_post.id}"

      expect(response).to have_http_status(:ok)
      detail = JSON.parse(response.body)["job_post"]
      expect(detail).to include(
        "id" => job_post.id,
        "title" => "Staff Engineer",
        "company" => "Acme",
        "posting_url" => "https://example.com/job",
        "match_score" => 88,
        "scoring_status" => "scored",
        "summary" => "great fit",
        "relevant_requirements" => [ "Go" ],
        "missing_requirements" => [ "K8s" ],
        "red_flags" => [ "on-call" ],
        "resume_alignment_notes" => "strong overlap",
        "application_strategy" => "apply direct"
      )
      expect(detail["route"]).to eq(
        "route_type" => "greenhouse",
        "recommended_route" => "direct_ats",
        "application_url" => "https://boards.greenhouse.io/acme"
      )
      expect(detail["application"]).to be_nil
    end

    it "includes the current tracker state when a job has an application" do
      sign_in!
      company = Company.create!(name: "Acme")
      job_post = JobPost.create!(company: company, title: "Staff Engineer")
      application = Application.create!(
        job_post: job_post,
        status: "draft",
        pipeline_status: "interviewing",
        pipeline_stage: "phone_screen"
      )

      get "/api/job_posts/#{job_post.id}"

      expect(response).to have_http_status(:ok)
      tracker = JSON.parse(response.body).dig("job_post", "application")
      expect(tracker).to include(
        "application_id" => application.id,
        "automation_status" => "draft",
        "pipeline_status" => "interviewing",
        "pipeline_stage" => "phone_screen"
      )
    end

    it "returns the consistent JSON error shape for an unknown id" do
      sign_in!

      get "/api/job_posts/999999"

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)).to eq(
        "error" => { "code" => "not_found", "message" => "JobPost not found" }
      )
    end

    it "requires authentication" do
      get "/api/job_posts/1"

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "PATCH /api/job_posts/:id/application_status" do
    it "creates a tracker application for a job and updates its pipeline state" do
      sign_in!
      company = Company.create!(name: "Acme")
      job_post = JobPost.create!(company: company, title: "Staff Engineer")

      expect do
        patch "/api/job_posts/#{job_post.id}/application_status", params: {
          application: { pipeline_status: "applied" }
        }
      end.to change(Application, :count).by(1)
        .and change(AuditEvent, :count).by(1)

      expect(response).to have_http_status(:ok)
      tracker = JSON.parse(response.body).fetch("application")
      expect(tracker).to include(
        "job_post_id" => job_post.id,
        "automation_status" => "draft",
        "pipeline_status" => "applied",
        "pipeline_stage" => "waiting"
      )
      app = Application.sole
      expect(app.job_post).to eq(job_post)
      expect(app.status).to eq("draft")
      expect(app.pipeline_status).to eq("applied")
      expect(app.pipeline_stage).to eq("waiting")
    end

    it "reuses the latest application for manual status changes" do
      sign_in!
      company = Company.create!(name: "Acme")
      job_post = JobPost.create!(company: company, title: "Staff Engineer")
      existing = Application.create!(job_post: job_post, status: "draft")

      expect do
        patch "/api/job_posts/#{job_post.id}/application_status", params: {
          application: { pipeline_status: "rejected", pipeline_stage: "" }
        }
      end.not_to change(Application, :count)

      expect(response).to have_http_status(:ok)
      expect(existing.reload.pipeline_status).to eq("rejected")
    end
  end
end
