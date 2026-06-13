require "rails_helper"

RSpec.describe "Api digest", type: :request do
  DIGEST_AUTH_ENV = {
    "APP_SHARED_SECRET" => "correct-passphrase",
    "SESSION_SECRET" => "session-signing-secret"
  }.freeze

  around do |example|
    original_env = DIGEST_AUTH_ENV.keys.to_h { |key| [ key, ENV[key] ] }
    DIGEST_AUTH_ENV.each { |key, value| ENV[key] = value }

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

  describe "GET /api/digest" do
    it "returns the latest digest of recently scored jobs without scoring on read" do
      sign_in!
      company = Company.create!(name: "Acme")
      JobPost.create!(company: company, title: "Recent Match", match_score: 92,
        scoring_status: "scored", scored_at: 2.hours.ago, summary: "fresh")
      JobPost.create!(company: company, title: "Pending", scoring_status: "pending")

      expect(ScoreJobPostJob).not_to receive(:perform_later)

      get "/api/digest"

      expect(response).to have_http_status(:ok)
      digest = JSON.parse(response.body)["digest"]
      expect(digest["date"]).to eq(Date.current.iso8601)
      titles = digest["jobs"].map { |j| j["title"] }
      expect(titles).to eq([ "Recent Match" ])
      expect(digest["jobs"].first).to include(
        "company" => "Acme",
        "match_score" => 92,
        "scoring_status" => "scored",
        "summary" => "fresh"
      )
    end

    it "returns an empty jobs list when nothing was recently scored" do
      sign_in!

      get "/api/digest"

      expect(response).to have_http_status(:ok)
      digest = JSON.parse(response.body)["digest"]
      expect(digest["date"]).to eq(Date.current.iso8601)
      expect(digest["jobs"]).to eq([])
    end

    it "requires authentication" do
      get "/api/digest"

      expect(response).to have_http_status(:unauthorized)
      expect(JSON.parse(response.body)).to eq(
        "error" => { "code" => "unauthorized", "message" => "Unauthorized" }
      )
    end
  end
end
