require "rails_helper"

RSpec.describe InboundEmailParser do
  def inbound_email(from:, text:)
    InboundEmail.create!(
      provider: "resend",
      event_id: "evt_#{SecureRandom.hex(4)}",
      event_type: "email.received",
      provider_email_id: "email_#{SecureRandom.hex(4)}",
      raw_payload: {
        "id" => "evt_123",
        "type" => "email.received",
        "data" => { "from" => from, "subject" => "Job alert", "text" => text }
      }
    )
  end

  describe "known-sender parsing" do
    it "parses a LinkedIn alert into normalized JobPost rows" do
      text = <<~TEXT
        Jobs for you

        Senior Backend Engineer
        Acme Corp · San Francisco, CA (Remote)
        https://www.linkedin.com/jobs/view/3812345678/

        Platform Engineer
        Globex · New York, NY
        https://www.linkedin.com/jobs/view/3899999999/?refId=abc
      TEXT
      email = inbound_email(from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", text:)

      result = described_class.new(email).call

      expect(result.fallback?).to be(false)
      expect(result.parser.source_name).to eq("linkedin")
      expect(result.job_posts.size).to eq(2)

      first = result.job_posts.first
      expect(first.title).to eq("Senior Backend Engineer")
      expect(first.company.name).to eq("Acme Corp")
      expect(first.location).to eq("San Francisco, CA (Remote)")
      expect(first.posting_url).to eq("https://www.linkedin.com/jobs/view/3812345678/")
      expect(first.source_url).to eq("https://www.linkedin.com/jobs/view/3812345678/")
      expect(first.source).to eq("linkedin")
      expect(first.scoring_status).to eq("pending")

      expect(email.reload.raw_payload.dig("parse_result", "needs_llm_fallback")).to be(false)
    end

    it "parses an Indeed alert into normalized JobPost rows" do
      text = <<~TEXT
        Staff Data Engineer - Globex Inc (Austin, TX)
        https://www.indeed.com/viewjob?jk=a1b2c3d4e5f6&from=alert
      TEXT
      email = inbound_email(from: "alerts@indeed.com", text:)

      result = described_class.new(email).call

      expect(result.parser.source_name).to eq("indeed")
      post = result.job_posts.sole
      expect(post.title).to eq("Staff Data Engineer")
      expect(post.company.name).to eq("Globex Inc")
      expect(post.location).to eq("Austin, TX")
      expect(post.posting_url).to eq("https://www.indeed.com/viewjob?jk=a1b2c3d4e5f6")
      expect(post.source).to eq("indeed")
    end

    it "parses a Glassdoor alert into normalized JobPost rows" do
      text = <<~TEXT
        Product Manager
        Initech — Remote, US
        https://www.glassdoor.com/job-listing/product-manager-initech-JV_IC123_KO0,15.htm
      TEXT
      email = inbound_email(from: "noreply@glassdoor.com", text:)

      result = described_class.new(email).call

      expect(result.parser.source_name).to eq("glassdoor")
      post = result.job_posts.sole
      expect(post.title).to eq("Product Manager")
      expect(post.company.name).to eq("Initech")
      expect(post.location).to eq("Remote, US")
      expect(post.source).to eq("glassdoor")
    end

    it "reuses an existing company instead of duplicating it" do
      existing = Company.create!(name: "Acme Corp")
      text = <<~TEXT
        Senior Backend Engineer
        Acme Corp · San Francisco, CA
        https://www.linkedin.com/jobs/view/3812345678/
      TEXT
      email = inbound_email(from: "jobs@linkedin.com", text:)

      expect { described_class.new(email).call }.not_to change(Company, :count)
      expect(JobPost.last.company).to eq(existing)
    end

    it "matches a forwarded alert via the original sender in the body" do
      text = <<~TEXT
        ---------- Forwarded message ---------
        From: LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>

        Senior Backend Engineer
        Acme Corp · San Francisco, CA
        https://www.linkedin.com/jobs/view/3812345678/
      TEXT
      # Envelope From is the forwarder, not LinkedIn.
      email = inbound_email(from: "Aden Guo <aden.guowe@gmail.com>", text:)

      result = described_class.new(email).call

      expect(result.fallback?).to be(false)
      expect(result.parser.source_name).to eq("linkedin")
      expect(result.job_posts.size).to eq(1)
    end

    it "does not duplicate a JobPost when the same posting URL is parsed twice" do
      text = <<~TEXT
        Senior Backend Engineer
        Acme Corp · San Francisco, CA
        https://www.linkedin.com/jobs/view/3812345678/
      TEXT
      first = inbound_email(from: "jobs@linkedin.com", text:)
      described_class.new(first).call

      second = inbound_email(from: "jobs@linkedin.com", text:)
      expect { described_class.new(second).call }.not_to change(JobPost, :count)
    end
  end

  describe "LLM fallback" do
    it "flags unknown senders for fallback and never creates a JobPost" do
      email = inbound_email(
        from: "alerts@unknownboard.example",
        text: "Some Role at Some Company https://unknownboard.example/jobs/1"
      )

      expect do
        result = described_class.new(email).call
        expect(result.fallback?).to be(true)
        expect(result.parser).to be_nil
        expect(result.job_posts).to be_empty
      end.not_to change(JobPost, :count)

      parse_result = email.reload.raw_payload.fetch("parse_result")
      expect(parse_result["needs_llm_fallback"]).to be(true)
      expect(parse_result["status"]).to eq("unknown_sender")
      expect(email.raw_payload.dig("data", "text")).to include("unknownboard.example")
    end

    it "flags a known sender whose body yields no postings for fallback" do
      email = inbound_email(
        from: "jobalerts-noreply@linkedin.com",
        text: "You have new recommendations. Open LinkedIn to view them."
      )

      result = described_class.new(email).call

      expect(result.fallback?).to be(true)
      expect(result.parser.source_name).to eq("linkedin")
      expect(result.job_posts).to be_empty
      parse_result = email.reload.raw_payload.fetch("parse_result")
      expect(parse_result["status"]).to eq("matched_no_postings")
      expect(parse_result["needs_llm_fallback"]).to be(true)
    end
  end
end
