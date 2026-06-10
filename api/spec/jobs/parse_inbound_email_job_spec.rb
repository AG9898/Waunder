require "rails_helper"

RSpec.describe ParseInboundEmailJob, type: :job do
  it "parses a known-sender email into JobPost rows" do
    email = InboundEmail.create!(
      provider: "resend",
      event_id: "evt_job_1",
      event_type: "email.received",
      raw_payload: {
        "type" => "email.received",
        "data" => {
          "from" => "jobs@linkedin.com",
          "subject" => "Job alert",
          "text" => "Senior Backend Engineer\n" \
            "Acme Corp · San Francisco, CA\n" \
            "https://www.linkedin.com/jobs/view/3812345678/\n"
        }
      }
    )

    expect { described_class.perform_now(email) }.to change(JobPost, :count).by(1)
    expect(email.reload.raw_payload.dig("parse_result", "needs_llm_fallback")).to be(false)
  end

  it "flags an unknown-sender email for LLM fallback without creating a JobPost" do
    email = InboundEmail.create!(
      provider: "resend",
      event_id: "evt_job_2",
      event_type: "email.received",
      raw_payload: {
        "type" => "email.received",
        "data" => { "from" => "alerts@unknownboard.example", "text" => "A role somewhere" }
      }
    )

    expect { described_class.perform_now(email) }.not_to change(JobPost, :count)
    expect(email.reload.raw_payload.dig("parse_result", "needs_llm_fallback")).to be(true)
  end
end
