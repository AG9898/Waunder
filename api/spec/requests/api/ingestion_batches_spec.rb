require "rails_helper"

RSpec.describe "Api ingestion batches", type: :request do
  BATCHES_AUTH_ENV = {
    "APP_SHARED_SECRET" => "correct-passphrase",
    "SESSION_SECRET" => "session-signing-secret"
  }.freeze

  around do |example|
    original_env = BATCHES_AUTH_ENV.keys.to_h { |key| [ key, ENV[key] ] }
    BATCHES_AUTH_ENV.each { |key, value| ENV[key] = value }

    example.run
  ensure
    original_env.each do |key, value|
      value.nil? ? ENV.delete(key) : ENV[key] = value
    end
  end

  def sign_in!
    post "/api/session", params: { passphrase: "correct-passphrase" }
    expect(response).to have_http_status(:ok)
  end

  describe "GET /api/ingestion_batches" do
    it "returns batches of recently ingested jobs newest first without scoring on read" do
      sign_in!
      company = Company.create!(name: "Acme")
      old = JobPost.create!(company: company, title: "Older", source: "linkedin",
        match_score: 70, scoring_status: "scored")
      old.update_column(:created_at, 2.hours.ago)
      new = JobPost.create!(company: company, title: "Newer", source: "glassdoor",
        match_score: 90, scoring_status: "scored")
      new.update_column(:created_at, 1.minute.ago)

      expect(ScoreJobPostJob).not_to receive(:perform_later)

      get "/api/ingestion_batches"

      expect(response).to have_http_status(:ok)
      batches = JSON.parse(response.body)["batches"]
      expect(batches.map { |b| b["source"] }).to eq(%w[glassdoor linkedin])
      expect(batches.first).to include("count" => 1, "date" => Date.current.iso8601)
      expect(batches.first["jobs"].first).to include(
        "title" => "Newer", "company" => "Acme", "match_score" => 90
      )
    end

    it "returns an empty list when nothing was ingested" do
      sign_in!

      get "/api/ingestion_batches"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["batches"]).to eq([])
      expect(body["page"]).to include(
        "number" => 1, "size" => Api::JobPostsController.page_size,
        "total" => 0, "has_next" => false
      )
    end

    it "paginates batches newest-first with the shared page envelope" do
      sign_in!
      original = ENV["JOBS_PAGE_SIZE"]
      ENV["JOBS_PAGE_SIZE"] = "2"

      company = Company.create!(name: "Acme")
      # Three distinct ingestion events: different sources / time gaps so each
      # post becomes its own batch (newest source first by ingested_at).
      [
        [ "linkedin", 30.minutes.ago ],
        [ "glassdoor", 20.minutes.ago ],
        [ "manual", 10.minutes.ago ]
      ].each_with_index do |(source, created), i|
        post = JobPost.create!(company: company, title: "Job #{i}", source: source,
          match_score: 50, scoring_status: "scored")
        post.update_column(:created_at, created)
      end

      get "/api/ingestion_batches", params: { page: 1 }
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["batches"].length).to eq(2)
      expect(body["batches"].map { |b| b["source"] }).to eq(%w[manual glassdoor])
      expect(body["page"]).to include(
        "number" => 1, "size" => 2, "total" => 3, "has_next" => true
      )

      get "/api/ingestion_batches", params: { page: 2 }
      body = JSON.parse(response.body)
      expect(body["batches"].map { |b| b["source"] }).to eq(%w[linkedin])
      expect(body["page"]).to include(
        "number" => 2, "size" => 2, "total" => 3, "has_next" => false
      )
    ensure
      original.nil? ? ENV.delete("JOBS_PAGE_SIZE") : ENV["JOBS_PAGE_SIZE"] = original
    end

    it "requires authentication" do
      get "/api/ingestion_batches"

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
