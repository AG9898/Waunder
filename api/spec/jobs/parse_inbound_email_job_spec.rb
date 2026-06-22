require "rails_helper"

RSpec.describe ParseInboundEmailJob, type: :job do
  def inbound_email(data:, parse_result: nil)
    payload = { "type" => "email.received", "data" => data }
    payload["parse_result"] = parse_result if parse_result
    InboundEmail.create!(
      provider: "resend",
      event_id: "evt_#{SecureRandom.hex(4)}",
      event_type: "email.received",
      provider_email_id: data["email_id"],
      raw_payload: payload
    )
  end

  it "parses a known-sender email into JobPost rows and enqueues scoring" do
    email = inbound_email(data: {
      "from" => "jobs@linkedin.com",
      "subject" => "Job alert",
      "text" => "Senior Backend Engineer\n" \
        "Acme Corp · San Francisco, CA\n" \
        "https://www.linkedin.com/jobs/view/3812345678/\n"
    })

    expect { described_class.perform_now(email) }
      .to change(JobPost, :count).by(1)
      .and have_enqueued_job(ScoreJobPostJob)
    expect(email.reload.raw_payload.dig("parse_result", "needs_llm_fallback")).to be(false)
  end

  it "hydrates a metadata-only email from the Resend receiving API before parsing" do
    email = inbound_email(data: {
      "from" => "jobs@linkedin.com",
      "subject" => "Job alert",
      "email_id" => "rcv_abc123"
      # no text/html — as actually delivered by the Resend webhook
    })
    fetched = {
      "text" => "Staff Engineer\nGlobex · Remote\nhttps://www.linkedin.com/jobs/view/9999999999/\n"
    }
    fake_client = instance_double(ResendInboundClient, fetch: fetched)
    allow(ResendInboundClient).to receive(:new).and_return(fake_client)

    expect { described_class.perform_now(email) }.to change(JobPost, :count).by(1)
    expect(fake_client).to have_received(:fetch).with("rcv_abc123")
    expect(email.reload.raw_payload.dig("data", "text")).to include("Staff Engineer")
    expect(JobPost.last.title).to eq("Staff Engineer")
  end

  it "matches a forwarded LinkedIn alert via the in-body From header" do
    email = inbound_email(data: {
      "from" => "aden@gmail.com",
      "subject" => "Fwd: Senior Backend Engineer at Acme",
      "text" => "---------- Forwarded message ---------\n" \
        "From: LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>\n\n" \
        "Senior Backend Engineer\n" \
        "Acme Corp · San Francisco, CA\n" \
        "https://www.linkedin.com/jobs/view/3812345678/\n"
    })

    expect { described_class.perform_now(email) }.to change(JobPost, :count).by(1)
    expect(email.reload.raw_payload.dig("parse_result", "parser")).to eq("linkedin")
  end

  it "extracts postings via the LLM fallback for an unknown sender" do
    email = inbound_email(data: {
      "from" => "alerts@unknownboard.example",
      "subject" => "New roles",
      "text" => "Frontend Engineer at Initech, Remote"
    })
    fake_llm = instance_double("client")
    allow(fake_llm).to receive(:complete_json).and_return(
      "postings" => [ { "title" => "Frontend Engineer", "company" => "Initech", "location" => "Remote" } ]
    )
    allow(OpenrouterClient).to receive(:new).and_return(fake_llm)

    expect { described_class.perform_now(email) }
      .to change(JobPost, :count).by(1)
      .and have_enqueued_job(ScoreJobPostJob)
    expect(email.reload.raw_payload.dig("parse_result", "status")).to eq("llm_parsed")
  end

  it "flags an unknown-sender email and creates nothing when the LLM is unavailable" do
    email = inbound_email(data: {
      "from" => "alerts@unknownboard.example",
      "text" => "A role somewhere"
    })
    allow(OpenrouterClient).to receive(:new).and_raise(OpenrouterClient::MissingApiKeyError)

    expect { described_class.perform_now(email) }.not_to change(JobPost, :count)
    expect(email.reload.raw_payload.dig("parse_result", "needs_llm_fallback")).to be(true)
  end
end
