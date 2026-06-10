require "rails_helper"

RSpec.describe "Api profile and resume ingest", type: :request do
  let(:auth_env) do
    {
      "APP_SHARED_SECRET" => "correct-passphrase",
      "SESSION_SECRET" => "session-signing-secret",
      "WORKER_SERVICE_TOKEN" => "worker-service-token"
    }
  end

  let(:resume_json) do
    {
      "basics" => {
        "name" => "Aden Guo",
        "label" => "Software Engineer",
        "email" => "aden.guowe@gmail.com",
        "phone" => "587-888-4188",
        "summary" => "Full-stack developer.",
        "location" => { "city" => "Calgary", "region" => "AB", "countryCode" => "CA" },
        "profiles" => [
          { "network" => "LinkedIn", "url" => "https://linkedin.com/in/aden-guo" }
        ],
        "url" => "https://aden.dev"
      },
      "work" => [ { "name" => "University of Calgary", "position" => "Lead" } ],
      "education" => [ { "institution" => "University of Calgary" } ],
      "skills" => [ { "name" => "Languages", "keywords" => %w[Ruby Python] } ]
    }
  end

  around do |example|
    original = auth_env.keys.to_h { |key| [ key, ENV[key] ] }
    auth_env.each { |key, value| ENV[key] = value }

    example.run
  ensure
    original.each do |key, value|
      value.nil? ? ENV.delete(key) : ENV[key] = value
    end
  end

  def sign_in!
    post "/api/session", params: { passphrase: "correct-passphrase" }
    expect(response).to have_http_status(:ok)
  end

  describe "POST /api/profile/resume" do
    it "rejects unauthenticated ingest with 401" do
      post "/api/profile/resume", params: { resume: resume_json.to_json }

      expect(response).to have_http_status(:unauthorized)
      expect(Profile.count).to eq(0)
    end

    it "maps a JSON Resume into the Profile and a primary ResumeDocument" do
      sign_in!

      pdf = Rack::Test::UploadedFile.new(
        Rails.root.join("spec/fixtures/files/resume.pdf"), "application/pdf"
      )

      post "/api/profile/resume",
           params: { resume: resume_json.to_json, resume_markdown: "# Aden Guo\nDeveloper", resume_pdf: pdf }

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body.dig("resume", "parse_status")).to eq("parsed")
      expect(body.dig("resume", "file_attached")).to be(true)
      expect(body.dig("profile", "full_name")).to eq("Aden Guo")

      profile = Profile.sole
      expect(profile.full_name).to eq("Aden Guo")
      expect(profile.headline).to eq("Software Engineer")
      expect(profile.location).to eq("Calgary, AB, CA")
      expect(profile.email).to eq("aden.guowe@gmail.com")
      expect(profile.linkedin_url).to eq("https://linkedin.com/in/aden-guo")
      expect(profile.portfolio_url).to eq("https://aden.dev")
      expect(profile.skills).to eq(resume_json["skills"])

      document = profile.resume_documents.sole
      expect(document).to be_primary
      expect(document.parsed_structure).to eq(resume_json)
      expect(document.raw_text).to eq("# Aden Guo\nDeveloper")
      expect(document.file).to be_attached
    end

    it "stores sensitive contact fields and resume content encrypted at rest" do
      sign_in!
      post "/api/profile/resume", params: { resume: resume_json.to_json, resume_markdown: "secret text" }

      profile = Profile.sole
      raw = ActiveRecord::Base.connection.select_one(
        "SELECT email, phone FROM profiles WHERE id = #{profile.id}"
      )
      expect(raw["phone"]).not_to include("587-888-4188")

      document = profile.resume_documents.sole
      raw_doc = ActiveRecord::Base.connection.select_one(
        "SELECT raw_text FROM resume_documents WHERE id = #{document.id}"
      )
      expect(raw_doc["raw_text"]).not_to include("secret text")
    end

    it "re-syncs onto the same primary document instead of duplicating" do
      sign_in!
      post "/api/profile/resume", params: { resume: resume_json.to_json }
      updated = resume_json.deep_dup
      updated["basics"]["label"] = "Staff Engineer"
      post "/api/profile/resume", params: { resume: updated.to_json }

      expect(Profile.count).to eq(1)
      expect(ResumeDocument.count).to eq(1)
      expect(Profile.sole.headline).to eq("Staff Engineer")
    end

    it "returns 422 for a payload missing basics.name" do
      sign_in!
      post "/api/profile/resume", params: { resume: { "basics" => {} }.to_json }

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body).dig("error", "code")).to eq("unprocessable")
    end

    it "returns 422 for malformed JSON" do
      sign_in!
      post "/api/profile/resume", params: { resume: "{not json" }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /api/profile" do
    it "requires authentication" do
      get "/api/profile"
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns the structured profile with contact presence flags but not raw PII" do
      sign_in!
      post "/api/profile/resume", params: { resume: resume_json.to_json }

      get "/api/profile"

      expect(response).to have_http_status(:ok)
      payload = JSON.parse(response.body).fetch("profile")
      expect(payload["full_name"]).to eq("Aden Guo")
      expect(payload.dig("contact", "email_present")).to be(true)
      expect(payload).not_to have_key("email")
      expect(payload.dig("resume", "parse_status")).to eq("parsed")
    end
  end

  describe "PATCH /api/profile" do
    it "updates structured fields" do
      sign_in!
      post "/api/profile/resume", params: { resume: resume_json.to_json }

      patch "/api/profile", params: { profile: { headline: "Principal Engineer" } }

      expect(response).to have_http_status(:ok)
      expect(Profile.sole.headline).to eq("Principal Engineer")
    end

    it "returns 422 when full_name is cleared" do
      sign_in!
      post "/api/profile/resume", params: { resume: resume_json.to_json }

      patch "/api/profile", params: { profile: { full_name: "" } }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
