require "rails_helper"

RSpec.describe AuditEvent, type: :model do
  it "requires an application and documented status" do
    audit_event = described_class.new(status: "unsupported")

    expect(audit_event).not_to be_valid
    expect(audit_event.errors[:application]).to include("must exist")
    expect(audit_event.errors[:status]).to include("is not included in the list")
  end

  it "stores screenshots and logs as auditable arrays" do
    audit_event = described_class.new(screenshots: {}, logs: {}, metadata: [])

    expect(audit_event).not_to be_valid
    expect(audit_event.errors[:screenshots]).to include("must be an array")
    expect(audit_event.errors[:logs]).to include("must be an array")
    expect(audit_event.errors[:metadata]).to include("must be an object")
  end
end
