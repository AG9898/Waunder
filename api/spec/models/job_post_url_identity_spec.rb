require "rails_helper"

RSpec.describe JobPostUrlIdentity, type: :model do
  let(:job_post) { JobPost.create!(company: Company.create!(name: "Example Co"), title: "Engineer") }

  it "allows every documented URL role" do
    expect(described_class::ROLES).to contain_exactly("source", "posting", "application")
  end

  it "requires an original URL, identity key, and documented role" do
    identity = described_class.new(job_post:, original_url: "", identity_key: "", role: "unknown")

    expect(identity).not_to be_valid
    expect(identity.errors[:original_url]).to include("can't be blank")
    expect(identity.errors[:identity_key]).to include("can't be blank")
    expect(identity.errors[:role]).to include("is not included in the list")
  end

  it "preserves the original URL alongside its identity key" do
    original_url = "https://www.linkedin.com/jobs/view/123/?trk=alert"
    identity = described_class.create!(job_post:, role: "posting", original_url:, identity_key: "linkedin:123")

    expect(identity.original_url).to eq(original_url)
    expect(identity.identity_key).to eq("linkedin:123")
  end

  it "prevents duplicate aliases for a job post and role" do
    described_class.create!(
      job_post:,
      role: "source",
      original_url: "https://example.com/jobs/123",
      identity_key: "url:https://example.com/jobs/123"
    )
    duplicate = described_class.new(
      job_post:,
      role: "source",
      original_url: "https://example.com/jobs/123",
      identity_key: "url:https://example.com/jobs/123"
    )

    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:original_url]).to include("has already been taken")
  end
end
