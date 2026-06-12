require "rails_helper"

RSpec.describe "Api outreach drafts", type: :request do
  OUTREACH_AUTH_ENV = {
    "APP_SHARED_SECRET" => "correct-passphrase",
    "SESSION_SECRET" => "session-signing-secret",
    "WORKER_SERVICE_TOKEN" => "worker-service-token"
  }.freeze

  # Fake OpenRouter client: returns a canned completion and never touches the
  # network or sends the message anywhere.
  class FakeOutreachClient
    attr_reader :calls

    def initialize(payload)
      @payload = payload
      @calls = []
    end

    def complete_json(messages, **_opts)
      @calls << messages
      @payload
    end
  end

  around do |example|
    original_env = OUTREACH_AUTH_ENV.keys.to_h { |key| [ key, ENV[key] ] }
    OUTREACH_AUTH_ENV.each { |key, value| ENV[key] = value }

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
  let(:candidate) do
    job_post.contact_candidates.create!(name: "Dana Lee", relevance_reason: "Hiring manager")
  end

  describe "POST /api/contact_candidates/:contact_candidate_id/outreach_drafts" do
    it "generates a prefilled outreach draft without sending it" do
      fake = FakeOutreachClient.new("message" => "Hi Dana, I admire Acme's work...")
      allow(OpenrouterClient).to receive(:new).and_return(fake)
      sign_in!

      expect do
        post "/api/contact_candidates/#{candidate.id}/outreach_drafts", params: {
          outreach_draft: { loose_template: "Reach out warmly" }
        }
      end.to change { candidate.outreach_drafts.count }.by(1)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body.dig("outreach_draft", "message")).to eq("Hi Dana, I admire Acme's work...")
      expect(body.dig("outreach_draft", "loose_template")).to eq("Reach out warmly")
      # The fake client only generates text; nothing is sent.
      expect(fake.calls.length).to eq(1)
    end

    it "returns 503 when no LLM API key is configured" do
      allow(OpenrouterClient).to receive(:new)
        .and_raise(OpenrouterClient::MissingApiKeyError)
      sign_in!

      expect do
        post "/api/contact_candidates/#{candidate.id}/outreach_drafts"
      end.not_to change(OutreachDraft, :count)

      expect(response).to have_http_status(:service_unavailable)
      expect(JSON.parse(response.body).dig("error", "code")).to eq("llm_unavailable")
    end

    it "returns 404 for an unknown contact candidate" do
      sign_in!

      post "/api/contact_candidates/0/outreach_drafts"

      expect(response).to have_http_status(:not_found)
    end

    it "returns 401 when unauthenticated" do
      post "/api/contact_candidates/#{candidate.id}/outreach_drafts"

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
