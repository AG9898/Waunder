require "rails_helper"

RSpec.describe CoverLetterGenerator, type: :service do
  class FakeCoverLetterClient
    attr_reader :calls

    def initialize(payload)
      @payload = payload
      @calls = []
    end

    def complete_json(input, **)
      @calls << input
      @payload
    end
  end

  def profile
    Profile.create!(
      full_name: "Jane Doe",
      headline: "Senior Backend Engineer",
      summary: "Builds reliable distributed systems.",
      skills: [ "Ruby", "Rails" ],
      work_history: [ { "company" => "Acme", "title" => "Engineer" } ]
    )
  end

  def job_post
    company = Company.create!(name: "Example Co")
    JobPost.create!(
      company:,
      title: "Platform Engineer",
      description: "Build dependable developer infrastructure with Ruby.",
      summary: "Platform engineering role.",
      relevant_requirements: [ "Ruby", "distributed systems" ]
    )
  end

  it "grounds one saved letter in the job, profile, and primary resume without creating an application" do
    prof = profile
    prof.resume_documents.create!(title: "Primary", primary: true, raw_text: "Jane built dependable Ruby APIs.")
    post = job_post
    client = FakeCoverLetterClient.new("cover_letter" => "Dear Example Co team,\n\nI would be excited to contribute.")

    result = described_class.new(post, profile: prof, client:).call

    expect(result).to be_generated
    expect(post.reload.cover_letter_draft.body).to include("Example Co")
    expect(post.applications).to be_empty
    prompt = client.calls.last.last.fetch(:content)
    expect(prompt).to include("Platform Engineer", "Example Co", "Jane built dependable Ruby APIs.")
  end

  it "replaces the current letter instead of accumulating versions" do
    post = job_post
    first = FakeCoverLetterClient.new("cover_letter" => "First letter")
    second = FakeCoverLetterClient.new("cover_letter" => "Second letter")

    described_class.new(post, client: first).call
    expect do
      described_class.new(post, client: second).call
    end.not_to change(CoverLetterDraft, :count)

    expect(post.reload.cover_letter_draft.body).to eq("Second letter")
  end

  it "fails safely when the completion has no usable letter" do
    post = job_post
    result = described_class.new(post, client: FakeCoverLetterClient.new("cover_letter" => " ")).call

    expect(result).to be_failed
    expect(post.cover_letter_draft).to be_nil
  end

  it "skips when no OpenRouter key is configured" do
    post = job_post
    allow(OpenrouterClient).to receive(:new).and_raise(OpenrouterClient::MissingApiKeyError)

    result = described_class.new(post).call

    expect(result).to be_skipped
    expect(post.cover_letter_draft).to be_nil
  end

  it "never logs resume or generated-letter content" do
    prof = profile
    prof.resume_documents.create!(title: "Primary", primary: true, raw_text: "Jane Doe private resume")
    post = job_post
    logged = []
    allow(Rails.logger).to receive(:info) { |message| logged << message }

    described_class.new(post, profile: prof, client: FakeCoverLetterClient.new("cover_letter" => "Jane Doe private letter")).call

    expect(logged.join("\n")).not_to include("Jane Doe")
  end
end
