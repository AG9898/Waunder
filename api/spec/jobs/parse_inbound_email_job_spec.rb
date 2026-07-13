require "rails_helper"

RSpec.describe ParseInboundEmailJob, type: :job do
  include ActiveJob::TestHelper

  before do
    clear_enqueued_jobs
  end

  it "leaves an email held when intake is paused" do
    IntakeControl.current.pause!
    email = inbound_email(data: {
      "from" => "jobs@linkedin.com",
      "text" => "Senior Engineer\nAcme · Remote\nhttps://www.linkedin.com/jobs/view/3812345678/"
    })

    expect { described_class.perform_now(email) }.not_to change(JobPost, :count)
    expect(email.reload.intake_state).to eq("held")
  end

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

  it "parses a known-sender email into JobPost rows and enqueues scoring when triage passes" do
    email = inbound_email(data: {
      "from" => "jobs@linkedin.com",
      "subject" => "Job alert",
      "text" => "Senior Backend Engineer\n" \
        "Acme Corp · Vancouver, BC\n" \
        "https://www.linkedin.com/jobs/view/3812345678/\n"
    })

    expect { described_class.perform_now(email) }
      .to change(JobPost, :count).by(1)
      .and have_enqueued_job(ScoreJobPostJob)
    expect(email.reload.raw_payload.dig("parse_result", "needs_llm_fallback")).to be(false)
    expect(email.intake_state).to eq("processed")
    expect(JobPost.last.triage_status).to eq("eligible")
    expect(JobPost.last.triage_reasons).to include("location_vancouver_priority")
  end

  it "filters known-sender postings that miss target title/location rules without scoring" do
    email = inbound_email(data: {
      "from" => "jobs@linkedin.com",
      "subject" => "Job alert",
      "text" => "CAD Technician\n" \
        "DraftCo · Burnaby, BC\n" \
        "https://www.linkedin.com/jobs/view/3812345678/\n"
    })

    expect { described_class.perform_now(email) }.to change(JobPost, :count).by(1)
    expect(ActiveJob::Base.queue_adapter.enqueued_jobs).to be_empty

    post = JobPost.last
    expect(post.scoring_status).to eq("filtered")
    expect(post.triage_status).to eq("rejected")
    expect(post.lifecycle_state).to eq("backlog")
    expect(post.triage_reasons).to include("title_missing_target_role", "title_matches_exclusion")
  end

  it "auto-backlogs eligible inbound postings beyond the daily active limit" do
    original = ENV[JobPostTriage::DAILY_ACTIVE_LIMIT_ENV]
    ENV[JobPostTriage::DAILY_ACTIVE_LIMIT_ENV] = "1"
    company = Company.create!(name: "AlreadyActive")
    JobPost.create!(
      company: company,
      title: "Software Engineer",
      source: "linkedin",
      scoring_status: "deferred",
      triage_status: "eligible",
      triage_score: 95,
      triage_reasons: [ "title_matches_target_roles", "location_vancouver_priority" ],
      lifecycle_state: "active",
      created_at: Time.current
    )
    email = inbound_email(data: {
      "from" => "jobs@linkedin.com",
      "subject" => "Job alert",
      "text" => "Backend Developer\n" \
        "CapCo · Calgary, AB\n" \
        "https://www.linkedin.com/jobs/view/3812345679/\n"
    })

    expect { described_class.perform_now(email) }.to change(JobPost, :count).by(1)

    post = JobPost.order(:created_at).last
    expect(post.triage_status).to eq("eligible")
    expect(post.lifecycle_state).to eq("backlog")
  ensure
    original.nil? ? ENV.delete(JobPostTriage::DAILY_ACTIVE_LIMIT_ENV) : ENV[JobPostTriage::DAILY_ACTIVE_LIMIT_ENV] = original
  end

  it "keeps eligible inbound postings active when under the daily active limit" do
    original = ENV[JobPostTriage::DAILY_ACTIVE_LIMIT_ENV]
    ENV[JobPostTriage::DAILY_ACTIVE_LIMIT_ENV] = "30"
    email = inbound_email(data: {
      "from" => "jobs@linkedin.com",
      "subject" => "Job alert",
      "text" => "Backend Developer\n" \
        "CapCo · Calgary, AB\n" \
        "https://www.linkedin.com/jobs/view/3812345680/\n"
    })

    expect { described_class.perform_now(email) }.to change(JobPost, :count).by(1)

    post = JobPost.order(:created_at).last
    expect(post.triage_status).to eq("eligible")
    expect(post.lifecycle_state).to eq("active")
  ensure
    original.nil? ? ENV.delete(JobPostTriage::DAILY_ACTIVE_LIMIT_ENV) : ENV[JobPostTriage::DAILY_ACTIVE_LIMIT_ENV] = original
  end

  it "defers eligible inbound postings beyond the daily automatic scoring limit" do
    original = ENV[JobPostTriage::AUTO_SCORE_DAILY_LIMIT_ENV]
    ENV[JobPostTriage::AUTO_SCORE_DAILY_LIMIT_ENV] = "1"
    company = Company.create!(name: "Budgeted")
    JobPost.create!(
      company: company,
      title: "Software Engineer",
      source: "linkedin",
      scoring_status: "scored",
      triage_status: "eligible",
      triage_score: 95,
      triage_reasons: [ "title_matches_target_roles", "location_vancouver_priority" ],
      created_at: Time.current
    )
    email = inbound_email(data: {
      "from" => "jobs@linkedin.com",
      "subject" => "Job alert",
      "text" => "Backend Developer\n" \
        "CapCo · Calgary, AB\n" \
        "https://www.linkedin.com/jobs/view/3812345679/\n"
    })

    expect { described_class.perform_now(email) }.to change(JobPost, :count).by(1)
    expect(ActiveJob::Base.queue_adapter.enqueued_jobs).to be_empty

    post = JobPost.order(:created_at).last
    expect(post.scoring_status).to eq("deferred")
    expect(post.triage_status).to eq("eligible")
  ensure
    original.nil? ? ENV.delete(JobPostTriage::AUTO_SCORE_DAILY_LIMIT_ENV) : ENV[JobPostTriage::AUTO_SCORE_DAILY_LIMIT_ENV] = original
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
