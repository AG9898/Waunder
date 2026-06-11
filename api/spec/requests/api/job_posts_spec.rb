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
end
