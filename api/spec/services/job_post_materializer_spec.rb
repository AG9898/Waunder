require "rails_helper"

RSpec.describe JobPostMaterializer do
  def posting(posting_url:, source_url: posting_url)
    {
      title: "Platform Engineer",
      company: "Acme",
      location: "Vancouver, BC",
      posting_url:,
      source_url:,
      source: "linkedin"
    }
  end

  it "registers stable source, posting, and resolved application aliases" do
    job_post = described_class.new(
      posting(
        posting_url: "https://www.linkedin.com/jobs/view/123?trk=alert",
        source_url: "https://www.linkedin.com/comm/jobs/view/123?trackingId=email"
      )
    ).call

    expect(job_post.url_identities.pluck(:role, :identity_key)).to contain_exactly(
      [ "source", "linkedin:123" ],
      [ "posting", "linkedin:123" ],
      [ "application", "linkedin:123" ]
    )
  end

  it "reuses stable identities on retries without duplicate aliases or LLM calls" do
    first = described_class.new(posting(posting_url: "https://www.linkedin.com/jobs/view/123?trk=alert")).call
    identity_count = JobPostUrlIdentity.count

    expect(OpenrouterClient).not_to receive(:new)
    expect do
      retry_post = described_class.new(
        posting(posting_url: "https://www.linkedin.com/comm/jobs/view/123?trackingId=email")
      ).call

      expect(retry_post).to eq(first)
    end.not_to change(JobPost, :count)
    expect(JobPostUrlIdentity.count).to eq(identity_count)
  end
end
