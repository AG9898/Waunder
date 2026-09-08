require "rails_helper"

RSpec.describe ManualJobPostImporter do
  def job_post(title: "Platform Engineer")
    JobPost.create!(company: Company.create!(name: "Acme"), title: title, source: "manual")
  end

  def add_alias(job_post, role:, original_url:)
    JobPostUrlIdentity.create!(
      job_post: job_post,
      role: role,
      original_url: original_url,
      identity_key: JobUrlIdentity.key(original_url)
    )
  end

  describe "#call" do
    it "creates a new post and records supplied URL aliases" do
      result = described_class.new(
        url: "https://www.linkedin.com/jobs/view/123?trk=alert",
        application_url: "https://boards.greenhouse.io/acme/jobs/456",
        text: "Platform Engineer\nBuild reliable systems.",
        company: "Acme"
      ).call

      expect(result).to be_ok
      expect(result.status).to eq("new")
      expect(result.application).to be_nil
      expect(result.job_post).to have_attributes(
        title: "Platform Engineer",
        posting_url: "https://www.linkedin.com/jobs/view/123?trk=alert",
        source_url: "https://www.linkedin.com/jobs/view/123?trk=alert"
      )
      expect(result.job_post.url_identities.pluck(:role, :identity_key)).to contain_exactly(
        [ "source", "linkedin:123" ],
        [ "posting", "linkedin:123" ],
        [ "application", "url:https://boards.greenhouse.io/acme/jobs/456" ]
      )
    end

    it "reuses an exact identity, adds the supplied application alias, and audits the import" do
      existing = job_post
      add_alias(existing, role: "source", original_url: "https://www.linkedin.com/jobs/view/123")
      application = Application.create!(job_post: existing, status: "failed")

      result = nil
      job_post_count = JobPost.count

      expect do
        result = described_class.new(
          url: "https://www.linkedin.com/comm/jobs/view/123?trk=alert",
          application_url: "https://jobs.lever.co/acme/platform-engineer"
        ).call
      end.to change(JobPostUrlIdentity, :count).by(3)
        .and change(JobPostAuditEvent, :count).by(1)

      expect(JobPost.count).to eq(job_post_count)
      expect(result).to be_ok
      expect(result).to have_attributes(
        job_post: existing,
        status: "already_tracked",
        application: application
      )
      event = existing.audit_events.last
      expect(event.event_type).to eq("manual_import_matched")
      expect(event.metadata).to include(
        "status" => "already_tracked",
        "identity_keys" => [ "linkedin:123", "url:https://jobs.lever.co/acme/platform-engineer" ]
      )
      expect(event.metadata.fetch("added_aliases")).to include(
        a_hash_including("role" => "application", "original_url" => "https://jobs.lever.co/acme/platform-engineer")
      )
    end

    %w[draft approved paused failed].each do |automation_status|
      it "reports #{automation_status} as already_tracked" do
        existing = job_post
        add_alias(existing, role: "posting", original_url: "https://www.linkedin.com/jobs/view/123")
        application = Application.create!(job_post: existing, status: automation_status)

        result = described_class.new(
          url: "https://www.linkedin.com/comm/jobs/view/123?trk=alert"
        ).call

        expect(result).to be_ok
        expect(result).to have_attributes(status: "already_tracked", application: application)
        expect(result.application.status).to eq(automation_status)
      end
    end

    it "reports already_submitted when any matching application was submitted" do
      existing = job_post
      add_alias(existing, role: "posting", original_url: "https://www.linkedin.com/jobs/view/123")
      Application.create!(job_post: existing, status: "submitted")
      Application.create!(job_post: existing, status: "draft")

      result = described_class.new(url: "https://www.linkedin.com/comm/jobs/view/123?trk=alert").call

      expect(result).to be_ok
      expect(result.status).to eq("already_submitted")
      expect(result.application.status).to eq("submitted")
    end

    it "rejects an invalid optional application URL" do
      result = described_class.new(
        text: "Platform Engineer",
        application_url: "ftp://jobs.example.com/apply"
      ).call

      expect(result).not_to be_ok
      expect(result.errors).to eq([ "Application URL must be an HTTP or HTTPS URL" ])
    end
  end
end
