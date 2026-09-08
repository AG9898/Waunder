require "rails_helper"

RSpec.describe JobPostUrlIdentityBackfill do
  def create_job_post(title:, source_url: nil, posting_url: nil)
    JobPost.create!(
      company: Company.create!(name: "#{title} Co"),
      title:,
      source_url:,
      posting_url:
    )
  end

  it "backfills normalized aliases, skips empty URLs, and is idempotent" do
    job_post = create_job_post(
      title: "Platform Engineer",
      source_url: "https://alerts.example.com/jobs/123?utm_source=mail",
      posting_url: "https://www.linkedin.com/jobs/view/123?trk=alert"
    )
    job_post.create_application_route!(
      route_type: "greenhouse",
      source_url: "https://boards.example.com/jobs/123?utm_source=mail",
      canonical_posting_url: "https://jobs.example.com/postings/123",
      application_url: "https://jobs.example.com/apply/123?utm_campaign=mail"
    )
    empty_urls = create_job_post(title: "Empty URLs", source_url: "", posting_url: nil)
    empty_urls.create_application_route!(route_type: "unknown", source_url: "", application_url: "")

    described_class.call

    aliases = job_post.url_identities.order(:role, :original_url).pluck(:role, :original_url, :identity_key)
    expect(aliases).to contain_exactly(
      [ "application", "https://jobs.example.com/apply/123?utm_campaign=mail", "url:https://jobs.example.com/apply/123" ],
      [ "posting", "https://jobs.example.com/postings/123", "url:https://jobs.example.com/postings/123" ],
      [ "posting", "https://www.linkedin.com/jobs/view/123?trk=alert", "linkedin:123" ],
      [ "source", "https://alerts.example.com/jobs/123?utm_source=mail", "url:https://alerts.example.com/jobs/123" ],
      [ "source", "https://boards.example.com/jobs/123?utm_source=mail", "url:https://boards.example.com/jobs/123" ]
    )
    expect(empty_urls.url_identities).to be_empty

    described_class.call

    expect(job_post.url_identities.count).to eq(5)
    expect(empty_urls.url_identities).to be_empty
  end

  it "keeps the lowest-id job post as the collision owner and audits the preserved duplicate" do
    canonical = create_job_post(
      title: "Canonical",
      source_url: "https://www.linkedin.com/jobs/view/123?trk=alert"
    )
    duplicate = create_job_post(
      title: "Duplicate",
      posting_url: "https://www.linkedin.com/comm/jobs/view/123?trackingId=mail"
    )

    described_class.call

    expect(canonical.url_identities.pluck(:identity_key)).to eq([ "linkedin:123" ])
    expect(duplicate.url_identities).to be_empty
    expect(JobPost.exists?(duplicate.id)).to be(true)
    audit = duplicate.audit_events.find_by!(event_type: described_class::COLLISION_EVENT_TYPE)
    expect(audit.metadata).to eq(
      "identity_key" => "linkedin:123",
      "canonical_job_post_id" => canonical.id,
      "discarded_aliases" => [
        {
          "role" => "posting",
          "original_url" => "https://www.linkedin.com/comm/jobs/view/123?trackingId=mail"
        }
      ]
    )

    described_class.call

    expect(duplicate.audit_events.where(event_type: described_class::COLLISION_EVENT_TYPE).count).to eq(1)
  end
end
