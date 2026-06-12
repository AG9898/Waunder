require "rails_helper"

RSpec.describe "Api contact candidates", type: :request do
  CONTACTS_AUTH_ENV = {
    "APP_SHARED_SECRET" => "correct-passphrase",
    "SESSION_SECRET" => "session-signing-secret",
    "WORKER_SERVICE_TOKEN" => "worker-service-token"
  }.freeze

  around do |example|
    original_env = CONTACTS_AUTH_ENV.keys.to_h { |key| [ key, ENV[key] ] }
    CONTACTS_AUTH_ENV.each { |key, value| ENV[key] = value }

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

  let(:company) { Company.create!(name: "Acme") }
  let(:job_post) { JobPost.create!(company: company, title: "Senior Engineer") }

  describe "POST /api/job_posts/:job_post_id/contact_candidates" do
    it "saves a contact candidate linked to the job post" do
      sign_in!

      expect do
        post "/api/job_posts/#{job_post.id}/contact_candidates", params: {
          contact_candidate: {
            name: "Dana Lee",
            title: "Engineering Manager",
            company_name: "Acme",
            linkedin_url: "https://linkedin.com/in/danalee",
            relevance_reason: "Hiring manager for this team"
          }
        }
      end.to change { job_post.contact_candidates.count }.by(1)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body.dig("contact_candidate", "name")).to eq("Dana Lee")
      expect(body.dig("contact_candidate", "job_post_id")).to eq(job_post.id)
      expect(body.dig("contact_candidate", "relevance_reason")).to eq("Hiring manager for this team")
    end

    it "rejects a candidate missing a relevance reason" do
      sign_in!

      expect do
        post "/api/job_posts/#{job_post.id}/contact_candidates", params: {
          contact_candidate: { name: "Dana Lee" }
        }
      end.not_to change(ContactCandidate, :count)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body).dig("error", "code")).to eq("invalid_input")
    end

    it "returns 401 when unauthenticated" do
      post "/api/job_posts/#{job_post.id}/contact_candidates", params: {
        contact_candidate: { name: "Dana Lee", relevance_reason: "x" }
      }

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "GET /api/job_posts/:job_post_id/contact_candidates" do
    it "lists contact candidates for the job post" do
      job_post.contact_candidates.create!(name: "Dana Lee", relevance_reason: "Hiring manager")
      sign_in!

      get "/api/job_posts/#{job_post.id}/contact_candidates"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["contact_candidates"].length).to eq(1)
      expect(body["contact_candidates"].first["name"]).to eq("Dana Lee")
    end

    it "returns 401 when unauthenticated" do
      get "/api/job_posts/#{job_post.id}/contact_candidates"

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
