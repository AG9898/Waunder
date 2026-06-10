require "rails_helper"

RSpec.describe ScoreJobPostJob, type: :job do
  # Mocked OpenRouter client: returns canned structured JSON without any network
  # call. Mirrors OpenrouterClient#complete_json's contract (parsed Hash).
  class FakeScoringClient
    def initialize(payload)
      @payload = payload
    end

    def complete_json(_messages, **)
      @payload
    end
  end

  def job_post(attrs = {})
    company = Company.find_or_create_by!(name: attrs.delete(:company) || "Acme Corp")
    JobPost.create!(
      {
        company: company,
        title: "Senior Backend Engineer",
        description: "Build APIs in Ruby. 5+ years experience.",
        scoring_status: "pending"
      }.merge(attrs)
    )
  end

  def canned_payload
    {
      "summary" => "Backend role building Ruby APIs.",
      "match_score" => 82,
      "relevant_requirements" => [ "Ruby", "API design" ],
      "missing_requirements" => [ "Kubernetes" ],
      "resume_alignment_notes" => "Lead with Ruby API work.",
      "application_strategy" => "Apply direct via ATS.",
      "red_flags" => [ "No salary listed" ]
    }
  end

  describe "scoring with a mocked client" do
    it "populates the scoring/summary fields on the JobPost from mocked LLM JSON" do
      post = job_post
      client = FakeScoringClient.new(canned_payload)

      JobScorer.new(post, client: client).call
      post.reload

      expect(post.scoring_status).to eq("scored")
      expect(post.scored_at).to be_present
      expect(post.summary).to eq("Backend role building Ruby APIs.")
      expect(post.match_score).to eq(82)
      expect(post.relevant_requirements).to eq([ "Ruby", "API design" ])
      expect(post.missing_requirements).to eq([ "Kubernetes" ])
      expect(post.resume_alignment_notes).to eq("Lead with Ruby API work.")
      expect(post.application_strategy).to eq("Apply direct via ATS.")
      expect(post.red_flags).to eq([ "No salary listed" ])
    end

    it "clamps an out-of-range match_score into 0..100" do
      post = job_post
      client = FakeScoringClient.new(canned_payload.merge("match_score" => 140))

      JobScorer.new(post, client: client).call

      expect(post.reload.match_score).to eq(100)
    end

    it "coerces non-array requirement fields into string arrays" do
      post = job_post
      client = FakeScoringClient.new(canned_payload.merge("red_flags" => nil, "relevant_requirements" => "Ruby"))

      JobScorer.new(post, client: client).call
      post.reload

      expect(post.red_flags).to eq([])
      expect(post.relevant_requirements).to eq([ "Ruby" ])
    end

    it "runs through ScoreJobPostJob end to end" do
      post = job_post
      allow(JobScorer).to receive(:new).and_return(
        instance_double(JobScorer, call: JobScorer::Result.new(status: "scored", job_post: post))
      )

      expect { described_class.perform_now(post) }.not_to raise_error
    end
  end

  describe "parser-flagged fallback postings" do
    it "scores a fallback posting through the same scorer" do
      # A posting the deterministic parser produced as a fallback is just a
      # JobPost in scoring_status 'pending'; the scorer treats it identically.
      post = job_post(scoring_status: "pending")
      client = FakeScoringClient.new(canned_payload)

      result = JobScorer.new(post, client: client).call

      expect(result).to be_scored
      expect(post.reload.scoring_status).to eq("scored")
    end
  end

  describe "no API key configured" do
    it "marks the post skipped without raising" do
      post = job_post
      allow(OpenrouterClient).to receive(:new)
        .and_raise(OpenrouterClient::MissingApiKeyError, "no key")

      result = nil
      expect { result = JobScorer.new(post).call }.not_to raise_error

      expect(result).to be_skipped
      expect(post.reload.scoring_status).to eq("skipped")
      expect(post.scored_at).to be_present
    end

    it "no-ops through the job without raising" do
      post = job_post
      allow(OpenrouterClient).to receive(:new)
        .and_raise(OpenrouterClient::MissingApiKeyError, "no key")

      expect { described_class.perform_now(post) }.not_to raise_error
      expect(post.reload.scoring_status).to eq("skipped")
    end
  end

  describe "graceful degradation on client errors" do
    it "marks the post failed when the client raises a request error" do
      post = job_post
      failing = instance_double(OpenrouterClient)
      allow(failing).to receive(:complete_json)
        .and_raise(OpenrouterClient::RequestError, "boom")

      result = JobScorer.new(post, client: failing).call

      expect(result.status).to eq("failed")
      expect(post.reload.scoring_status).to eq("failed")
    end
  end

  describe "PII safety" do
    it "never logs prompt or completion contents" do
      logged = []
      allow(Rails.logger).to receive(:info) { |msg| logged << msg }
      allow(Rails.logger).to receive(:warn) { |msg| logged << msg }

      post = job_post(description: "Resume of Jane Doe, email jane@example.com")
      client = FakeScoringClient.new(canned_payload.merge("summary" => "secret jane@example.com"))

      described_class.perform_now(post)

      joined = logged.join("\n")
      expect(joined).not_to include("Jane Doe")
      expect(joined).not_to include("jane@example.com")
    end
  end
end
