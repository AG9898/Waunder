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
    it "returns the scored active feed oldest-ingestion-first by default with a page envelope" do
      sign_in!
      company = Company.create!(name: "Acme")
      older = JobPost.create!(company: company, title: "Older", match_score: 40,
        scoring_status: "scored", summary: "older", created_at: 2.days.ago)
      newer = JobPost.create!(company: company, title: "Newer", match_score: 90,
        scoring_status: "scored", summary: "newer", created_at: 1.day.ago)
      JobPost.create!(company: company, title: "Filtered", scoring_status: "filtered",
        triage_status: "rejected", triage_score: 20)

      get "/api/job_posts"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["job_posts"].map { |jp| jp["id"] }).to eq([ older.id, newer.id ])
      first = body["job_posts"].first
      expect(first).to include(
        "title" => "Older",
        "company" => "Acme",
        "match_score" => 40,
        "scoring_status" => "scored",
        "lifecycle_state" => "active",
        "summary" => "older"
      )
      expect(body["page"]).to eq(
        "number" => 1,
        "size" => 30,
        "total" => 2,
        "has_next" => false
      )
    end

    it "ranks by match score when sort=score" do
      sign_in!
      company = Company.create!(name: "Acme")
      JobPost.create!(company: company, title: "Lower", match_score: 40, scoring_status: "scored")
      JobPost.create!(company: company, title: "Higher", match_score: 90, scoring_status: "scored")

      get "/api/job_posts", params: { sort: "score" }

      expect(response).to have_http_status(:ok)
      titles = JSON.parse(response.body)["job_posts"].map { |jp| jp["title"] }
      expect(titles).to eq(%w[Higher Lower])
    end

    it "excludes backlog and removed jobs from the active default" do
      sign_in!
      company = Company.create!(name: "Acme")
      active = JobPost.create!(company: company, title: "Active", match_score: 50,
        scoring_status: "scored", lifecycle_state: "active")
      JobPost.create!(company: company, title: "Backlogged", match_score: 60,
        scoring_status: "scored", lifecycle_state: "backlog")
      JobPost.create!(company: company, title: "Removed", match_score: 70,
        scoring_status: "scored", lifecycle_state: "removed")

      get "/api/job_posts"

      ids = JSON.parse(response.body)["job_posts"].map { |jp| jp["id"] }
      expect(ids).to eq([ active.id ])
    end

    it "returns backlog jobs when state=backlog" do
      sign_in!
      company = Company.create!(name: "Acme")
      backlogged = JobPost.create!(company: company, title: "Backlogged", match_score: 60,
        scoring_status: "scored", lifecycle_state: "backlog")
      JobPost.create!(company: company, title: "Active", match_score: 50,
        scoring_status: "scored", lifecycle_state: "active")

      get "/api/job_posts", params: { state: "backlog" }

      ids = JSON.parse(response.body)["job_posts"].map { |jp| jp["id"] }
      expect(ids).to eq([ backlogged.id ])
    end

    it "filters by score_band, source, location, and date range (AND-combined)" do
      sign_in!
      company = Company.create!(name: "Acme")
      target = JobPost.create!(company: company, title: "Target", match_score: 80,
        scoring_status: "scored", source: "linkedin", location: "Vancouver, BC",
        created_at: Time.zone.parse("2026-06-10 09:00"))
      JobPost.create!(company: company, title: "Low score", match_score: 40,
        scoring_status: "scored", source: "linkedin", location: "Vancouver, BC",
        created_at: Time.zone.parse("2026-06-10 09:00"))
      JobPost.create!(company: company, title: "Wrong source", match_score: 80,
        scoring_status: "scored", source: "glassdoor", location: "Vancouver, BC",
        created_at: Time.zone.parse("2026-06-10 09:00"))
      JobPost.create!(company: company, title: "Wrong location", match_score: 80,
        scoring_status: "scored", source: "linkedin", location: "Toronto, ON",
        created_at: Time.zone.parse("2026-06-10 09:00"))
      JobPost.create!(company: company, title: "Out of range", match_score: 80,
        scoring_status: "scored", source: "linkedin", location: "Vancouver, BC",
        created_at: Time.zone.parse("2026-06-01 09:00"))

      get "/api/job_posts", params: {
        score_band: "high", source: "linkedin", location: "vancouver",
        date_from: "2026-06-05", date_to: "2026-06-15"
      }

      titles = JSON.parse(response.body)["job_posts"].map { |jp| jp["title"] }
      expect(titles).to eq([ "Target" ])
      expect(JobPost.find(target.id)).to be_present
    end

    it "paginates with JOBS_PAGE_SIZE and reports has_next" do
      sign_in!
      company = Company.create!(name: "Acme")
      created = 3.times.map do |i|
        JobPost.create!(company: company, title: "Job #{i}", match_score: 50,
          scoring_status: "scored", created_at: i.days.ago)
      end

      original_page_size = ENV["JOBS_PAGE_SIZE"]
      ENV["JOBS_PAGE_SIZE"] = "2"

      get "/api/job_posts", params: { page: 1 }

      body = JSON.parse(response.body)
      expect(body["page"]).to include("size" => 2, "total" => 3, "number" => 1, "has_next" => true)
      expect(body["job_posts"].length).to eq(2)

      get "/api/job_posts", params: { page: 2 }

      body = JSON.parse(response.body)
      expect(body["page"]).to include("number" => 2, "has_next" => false)
      expect(body["job_posts"].length).to eq(1)
      # oldest-first default: page 2 carries the most recent job
      expect(body["job_posts"].first["id"]).to eq(created.first.id)
    ensure
      original_page_size.nil? ? ENV.delete("JOBS_PAGE_SIZE") : ENV["JOBS_PAGE_SIZE"] = original_page_size
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

  describe "PATCH /api/job_posts/:id/lifecycle" do
    it "transitions an active job to backlog and writes an audit event" do
      sign_in!
      company = Company.create!(name: "Acme")
      job_post = JobPost.create!(company: company, title: "Staff Engineer", lifecycle_state: "active")

      expect do
        patch "/api/job_posts/#{job_post.id}/lifecycle", params: { lifecycle_state: "backlog" }
      end.to change(JobPostAuditEvent, :count).by(1)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("job_post", "lifecycle_state")).to eq("backlog")
      expect(job_post.reload.lifecycle_state).to eq("backlog")

      event = JobPostAuditEvent.last
      expect(event.job_post).to eq(job_post)
      expect(event.event_type).to eq("lifecycle_changed")
      expect(event.metadata).to eq("from" => "active", "to" => "backlog")
    end

    it "soft-deletes via removed and is restorable back to active" do
      sign_in!
      company = Company.create!(name: "Acme")
      job_post = JobPost.create!(company: company, title: "Staff Engineer",
        posting_url: "https://example.com/job", lifecycle_state: "active")

      expect do
        patch "/api/job_posts/#{job_post.id}/lifecycle", params: { lifecycle_state: "removed" }
      end.not_to change(JobPost, :count)

      expect(job_post.reload.lifecycle_state).to eq("removed")
      expect(job_post.expires_at).to be_within(2.seconds).of(30.days.from_now)
      # Row persists so posting_url dedup still suppresses repeat alerts.
      expect(JobPost.exists?(posting_url: "https://example.com/job")).to be(true)
      expect(JobPost.active.where(id: job_post.id)).to be_empty

      patch "/api/job_posts/#{job_post.id}/lifecycle", params: { lifecycle_state: "active" }

      expect(job_post.reload.lifecycle_state).to eq("active")
      expect(job_post.expires_at).to be_nil
      expect(JobPostAuditEvent.count).to eq(2)
    end

    it "does not write an audit event for a no-op transition" do
      sign_in!
      company = Company.create!(name: "Acme")
      job_post = JobPost.create!(company: company, title: "Staff Engineer", lifecycle_state: "backlog")

      expect do
        patch "/api/job_posts/#{job_post.id}/lifecycle", params: { lifecycle_state: "backlog" }
      end.not_to change(JobPostAuditEvent, :count)

      expect(response).to have_http_status(:ok)
    end

    it "rejects an invalid lifecycle_state with the standard error shape" do
      sign_in!
      company = Company.create!(name: "Acme")
      job_post = JobPost.create!(company: company, title: "Staff Engineer")

      patch "/api/job_posts/#{job_post.id}/lifecycle", params: { lifecycle_state: "archived" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body).dig("error", "code")).to eq("invalid_input")
      expect(job_post.reload.lifecycle_state).to eq("active")
    end

    it "returns the standard not_found shape for an unknown id" do
      sign_in!

      patch "/api/job_posts/999999/lifecycle", params: { lifecycle_state: "backlog" }

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)).to eq(
        "error" => { "code" => "not_found", "message" => "JobPost not found" }
      )
    end

    it "requires authentication" do
      patch "/api/job_posts/1/lifecycle", params: { lifecycle_state: "backlog" }

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "PATCH /api/job_posts/lifecycle" do
    it "applies one lifecycle_state to many ids transactionally with audit events" do
      sign_in!
      company = Company.create!(name: "Acme")
      first = JobPost.create!(company: company, title: "One", lifecycle_state: "active")
      second = JobPost.create!(company: company, title: "Two", lifecycle_state: "active")

      expect do
        patch "/api/job_posts/lifecycle", params: { ids: [ first.id, second.id ], lifecycle_state: "removed" }
      end.to change(JobPostAuditEvent, :count).by(2)

      expect(response).to have_http_status(:ok)
      states = JSON.parse(response.body)["job_posts"].map { |jp| jp["lifecycle_state"] }
      expect(states).to all(eq("removed"))
      expect(first.reload.lifecycle_state).to eq("removed")
      expect(second.reload.lifecycle_state).to eq("removed")
    end

    it "returns not_found and changes nothing when any id is unknown" do
      sign_in!
      company = Company.create!(name: "Acme")
      job_post = JobPost.create!(company: company, title: "One", lifecycle_state: "active")

      expect do
        patch "/api/job_posts/lifecycle", params: { ids: [ job_post.id, 999999 ], lifecycle_state: "backlog" }
      end.not_to change(JobPostAuditEvent, :count)

      expect(response).to have_http_status(:not_found)
      expect(job_post.reload.lifecycle_state).to eq("active")
    end

    it "rejects an empty id list" do
      sign_in!

      patch "/api/job_posts/lifecycle", params: { ids: [], lifecycle_state: "backlog" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body).dig("error", "code")).to eq("invalid_input")
    end

    it "requires authentication" do
      patch "/api/job_posts/lifecycle", params: { ids: [ 1 ], lifecycle_state: "backlog" }

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
