require "rails_helper"

RSpec.describe InboundEmailLlmExtractor do
  # Fake OpenRouter client responding to complete_json with a canned payload.
  class FakeLlmClient
    attr_reader :calls

    def initialize(payload)
      @payload = payload
      @calls = 0
    end

    def complete_json(_messages, **)
      @calls += 1
      @payload
    end
  end

  def inbound_email(text:, status: "unknown_sender")
    InboundEmail.create!(
      provider: "resend",
      event_id: "evt_#{SecureRandom.hex(4)}",
      event_type: "email.received",
      provider_email_id: "email_#{SecureRandom.hex(4)}",
      raw_payload: {
        "type" => "email.received",
        "data" => { "from" => "aden@gmail.com", "subject" => "Fwd: a role", "text" => text },
        "parse_result" => { "status" => status, "needs_llm_fallback" => true }
      }
    )
  end

  it "extracts postings into JobPosts and clears the fallback flag" do
    client = FakeLlmClient.new(
      "postings" => [
        { "title" => "Data Scientist", "company" => "VRIFY", "location" => "Vancouver",
          "posting_url" => "https://example.com/jobs/1" }
      ]
    )
    email = inbound_email(text: "VRIFY is hiring a Data Scientist")

    result = nil
    expect { result = described_class.new(email, client: client).call }.to change(JobPost, :count).by(1)

    expect(result.status).to eq("llm_parsed")
    expect(result.job_posts.first.title).to eq("Data Scientist")
    expect(result.job_posts.first.company.name).to eq("VRIFY")
    expect(email.reload.raw_payload.dig("parse_result", "status")).to eq("llm_parsed")
    expect(email.raw_payload.dig("parse_result", "needs_llm_fallback")).to be(false)
  end

  it "keeps the fallback flag and creates nothing when the model finds no postings" do
    client = FakeLlmClient.new("postings" => [])
    email = inbound_email(text: "Newsletter, no jobs here")

    expect { described_class.new(email, client: client).call }.not_to change(JobPost, :count)
    expect(email.reload.raw_payload.dig("parse_result", "status")).to eq("llm_no_postings")
    expect(email.raw_payload.dig("parse_result", "needs_llm_fallback")).to be(true)
  end

  it "skips gracefully without an API key" do
    email = inbound_email(text: "anything")
    # No client injected and no OPENROUTER_API_KEY in test env.
    allow(OpenrouterClient).to receive(:new).and_raise(OpenrouterClient::MissingApiKeyError)

    result = nil
    expect { result = described_class.new(email).call }.not_to change(JobPost, :count)
    expect(result.status).to eq("llm_skipped")
    expect(email.reload.raw_payload.dig("parse_result", "needs_llm_fallback")).to be(true)
  end

  it "does not re-call the model for an already-extracted email" do
    client = FakeLlmClient.new("postings" => [])
    email = inbound_email(text: "anything", status: "llm_parsed")

    described_class.new(email, client: client).call

    expect(client.calls).to eq(0)
  end
end
