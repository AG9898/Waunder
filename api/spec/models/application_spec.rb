require "rails_helper"

RSpec.describe Application, type: :model do
  it "allows every documented status" do
    expect(described_class::STATUSES).to contain_exactly(
      "draft",
      "approved",
      "submitted",
      "paused",
      "failed"
    )
  end

  it "requires a job post and documented status" do
    application = described_class.new(status: "unsupported")

    expect(application).not_to be_valid
    expect(application.errors[:job_post]).to include("must exist")
    expect(application.errors[:status]).to include("is not included in the list")
  end

  it "owns a draft and audit events" do
    company = Company.create!(name: "Example Co")
    job_post = company.job_posts.create!(title: "Product Engineer")
    application = described_class.create!(job_post:)
    draft = application.create_application_draft!(
      structured_answers: [ { "name" => "first_name", "value" => "Ada" } ],
      autofill_payload: { "fields" => [] }
    )
    audit_event = application.audit_events.create!(status: "draft")

    expect(application.application_draft).to eq(draft)
    expect(application.audit_events).to contain_exactly(audit_event)
  end
end
