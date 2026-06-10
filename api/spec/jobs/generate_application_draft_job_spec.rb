require "rails_helper"

RSpec.describe GenerateApplicationDraftJob, type: :job do
  # Mocked OpenRouter client: returns canned structured JSON without any network
  # call. Mirrors OpenrouterClient#complete_json's contract (parsed Hash).
  class FakeDraftClient
    def initialize(payload)
      @payload = payload
    end

    def complete_json(_messages, **)
      @payload
    end
  end

  def profile(attrs = {})
    Profile.create!(
      {
        full_name: "Jane Doe",
        email: "jane@example.com",
        phone: "+1-555-0100",
        location: "Remote",
        headline: "Senior Backend Engineer",
        linkedin_url: "https://linkedin.com/in/janedoe",
        skills: [ "Ruby", "Rails" ],
        work_history: [ { "company" => "Acme", "title" => "Engineer" } ]
      }.merge(attrs)
    )
  end

  def application(route_type: "greenhouse", posting_url: "https://boards.greenhouse.io/acme/jobs/1")
    company = Company.find_or_create_by!(name: "Acme Corp")
    post = JobPost.create!(
      company: company,
      title: "Senior Backend Engineer",
      description: "Build APIs in Ruby. 5+ years experience.",
      posting_url: posting_url,
      summary: "Backend role building Ruby APIs.",
      relevant_requirements: [ "Ruby" ]
    )
    post.create_application_route!(
      route_type: route_type,
      recommended_route: "direct_ats",
      route_confidence: 0.99,
      application_url: posting_url
    )
    Application.create!(job_post: post, status: "draft")
  end

  def canned_payload
    {
      "resume_emphasis_notes" => "Lead with Ruby API work.",
      "cover_letter" => "Dear hiring team, I am excited...",
      "message" => "Hi, I'd love to apply for this role.",
      "structured_answers" => [
        { "question" => "Years of experience", "answer" => "6" },
        { "question" => "Why this role", "answer" => "I love building APIs." }
      ]
    }
  end

  describe "draft generation with a mocked client" do
    it "creates a draft with materials and an ATS-shaped autofill payload" do
      app = application
      prof = profile
      client = FakeDraftClient.new(canned_payload)

      result = ApplicationDraftGenerator.new(app, profile: prof, client: client).call
      expect(result).to be_generated

      draft = app.reload.application_draft
      expect(draft).to be_present
      expect(draft.resume_emphasis_notes).to eq("Lead with Ruby API work.")
      expect(draft.cover_letter).to start_with("Dear hiring team")
      expect(draft.message).to eq("Hi, I'd love to apply for this role.")
      expect(draft.structured_answers).to eq(
        [
          { "question" => "Years of experience", "answer" => "6" },
          { "question" => "Why this role", "answer" => "I love building APIs." }
        ]
      )

      payload = draft.autofill_payload
      expect(payload["ats"]).to eq("greenhouse")
      expect(payload["apply_url"]).to eq("https://boards.greenhouse.io/acme/jobs/1")
      expect(payload["answers"]).to be_an(Array)
      expect(payload["answers"]).to all(include("field", "value"))
    end

    it "incorporates Profile data into the autofill answers" do
      app = application
      prof = profile
      client = FakeDraftClient.new(canned_payload)

      ApplicationDraftGenerator.new(app, profile: prof, client: client).call
      answers = app.reload.application_draft.autofill_payload["answers"]
      fields = answers.to_h { |a| [ a["field"], a["value"] ] }

      expect(fields["full_name"]).to eq("Jane Doe")
      expect(fields["email"]).to eq("jane@example.com")
      expect(fields["linkedin_url"]).to eq("https://linkedin.com/in/janedoe")
      # Model structured answers are merged in as fields too.
      expect(fields["Years of experience"]).to eq("6")
    end

    it "keys the autofill payload to the resolved route's ATS shape" do
      app = application(route_type: "lever", posting_url: "https://jobs.lever.co/acme/1")
      client = FakeDraftClient.new(canned_payload)

      ApplicationDraftGenerator.new(app, profile: profile, client: client).call

      expect(app.reload.application_draft.autofill_payload["ats"]).to eq("lever")
    end

    it "falls back to a manual ATS for unknown routes" do
      app = application(route_type: "unknown", posting_url: "https://example.com/jobs/1")
      client = FakeDraftClient.new(canned_payload)

      ApplicationDraftGenerator.new(app, profile: profile, client: client).call

      expect(app.reload.application_draft.autofill_payload["ats"]).to eq("manual")
    end

    it "drops malformed structured answers" do
      app = application
      payload = canned_payload.merge(
        "structured_answers" => [
          { "question" => "Years", "answer" => "6" },
          { "question" => "", "answer" => "x" },
          "not a hash"
        ]
      )
      client = FakeDraftClient.new(payload)

      ApplicationDraftGenerator.new(app, profile: profile, client: client).call

      expect(app.reload.application_draft.structured_answers).to eq(
        [ { "question" => "Years", "answer" => "6" } ]
      )
    end

    it "runs through the job end to end" do
      app = application
      allow(ApplicationDraftGenerator).to receive(:new).and_return(
        instance_double(
          ApplicationDraftGenerator,
          call: ApplicationDraftGenerator::Result.new(status: "generated", application_draft: nil)
        )
      )

      expect { described_class.perform_now(app) }.not_to raise_error
    end
  end

  describe "no API key configured" do
    it "skips gracefully without creating a draft or raising" do
      app = application
      profile
      allow(OpenrouterClient).to receive(:new)
        .and_raise(OpenrouterClient::MissingApiKeyError, "no key")

      result = nil
      expect { result = ApplicationDraftGenerator.new(app).call }.not_to raise_error

      expect(result).to be_skipped
      expect(app.reload.application_draft).to be_nil
    end

    it "no-ops through the job without raising" do
      app = application
      allow(OpenrouterClient).to receive(:new)
        .and_raise(OpenrouterClient::MissingApiKeyError, "no key")

      expect { described_class.perform_now(app) }.not_to raise_error
      expect(app.reload.application_draft).to be_nil
    end
  end

  describe "graceful degradation on client errors" do
    it "returns a failed result when the client raises a request error" do
      app = application
      failing = instance_double(OpenrouterClient)
      allow(failing).to receive(:complete_json)
        .and_raise(OpenrouterClient::RequestError, "boom")

      result = ApplicationDraftGenerator.new(app, profile: profile, client: failing).call

      expect(result).to be_failed
      expect(app.reload.application_draft).to be_nil
    end
  end

  describe "PII safety" do
    it "never logs prompt or completion contents or profile PII" do
      logged = []
      allow(Rails.logger).to receive(:info) { |msg| logged << msg }
      allow(Rails.logger).to receive(:warn) { |msg| logged << msg }

      app = application
      prof = profile
      client = FakeDraftClient.new(canned_payload.merge("cover_letter" => "secret jane@example.com"))

      ApplicationDraftGenerator.new(app, profile: prof, client: client).call

      joined = logged.join("\n")
      expect(joined).not_to include("Jane Doe")
      expect(joined).not_to include("jane@example.com")
    end
  end
end
