require "rails_helper"

RSpec.describe "Api cover letter drafts", type: :request do
  COVER_LETTER_AUTH_ENV = {
    "APP_SHARED_SECRET" => "correct-passphrase",
    "SESSION_SECRET" => "session-signing-secret",
    "WORKER_SERVICE_TOKEN" => "worker-service-token"
  }.freeze

  class FakeCoverLetterClient
    attr_reader :calls

    def initialize(payload)
      @payload = payload
      @calls = []
    end

    def complete_json(messages, **)
      @calls << messages
      @payload
    end
  end

  around do |example|
    original_env = COVER_LETTER_AUTH_ENV.keys.to_h { |key| [ key, ENV[key] ] }
    COVER_LETTER_AUTH_ENV.each { |key, value| ENV[key] = value }
    example.run
  ensure
    original_env.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end

  def sign_in!
    post "/api/session", params: { passphrase: "correct-passphrase" }
    expect(response).to have_http_status(:ok)
  end

  let(:company) { Company.create!(name: "Acme") }
  let(:job_post) do
    JobPost.create!(company:, title: "Platform Engineer", description: "Build reliable systems.")
  end

  describe "GET /api/job_posts/:job_post_id/cover_letter_draft" do
    it "returns the current draft or null without generating anything" do
      sign_in!

      get "/api/job_posts/#{job_post.id}/cover_letter_draft"

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["cover_letter_draft"]).to be_nil
      expect(job_post.applications).to be_empty
    end
  end

  describe "POST /api/job_posts/:job_post_id/cover_letter_draft" do
    it "generates one manual-use letter without creating an application" do
      fake = FakeCoverLetterClient.new("cover_letter" => "Dear Acme team, I would love to contribute.")
      allow(OpenrouterClient).to receive(:new).and_return(fake)
      sign_in!

      expect do
        post "/api/job_posts/#{job_post.id}/cover_letter_draft"
      end.to change(CoverLetterDraft, :count).by(1)

      expect(response).to have_http_status(:created)
      expect(JSON.parse(response.body).dig("cover_letter_draft", "body")).to include("Acme")
      expect(job_post.reload.applications).to be_empty
      expect(fake.calls).to have_attributes(length: 1)
    end

    it "returns 503 when LLM generation is unavailable" do
      allow(OpenrouterClient).to receive(:new).and_raise(OpenrouterClient::MissingApiKeyError)
      sign_in!

      post "/api/job_posts/#{job_post.id}/cover_letter_draft"

      expect(response).to have_http_status(:service_unavailable)
      expect(JSON.parse(response.body).dig("error", "code")).to eq("llm_unavailable")
    end

    it "returns 502 for an upstream generation failure" do
      failing = instance_double(OpenrouterClient)
      allow(failing).to receive(:complete_json).and_raise(OpenrouterClient::RequestError)
      allow(OpenrouterClient).to receive(:new).and_return(failing)
      sign_in!

      post "/api/job_posts/#{job_post.id}/cover_letter_draft"

      expect(response).to have_http_status(:bad_gateway)
      expect(JSON.parse(response.body).dig("error", "code")).to eq("generation_failed")
    end

    it "requires an authenticated owner session" do
      post "/api/job_posts/#{job_post.id}/cover_letter_draft"

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
