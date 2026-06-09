require "rails_helper"

RSpec.describe ApplicationRoute, type: :model do
  it "allows every documented route type" do
    expect(described_class::ROUTE_TYPES).to contain_exactly(
      "company_careers",
      "greenhouse",
      "lever",
      "ashby",
      "workday",
      "linkedin_easy_apply",
      "indeed_apply",
      "glassdoor_apply",
      "unknown"
    )
  end

  it "requires a documented route type" do
    route = described_class.new(route_type: "unsupported")

    expect(route).not_to be_valid
    expect(route.errors[:route_type]).to include("is not included in the list")
  end

  it "bounds route confidence between zero and one" do
    route = described_class.new(route_type: "unknown", route_confidence: 1.1)

    expect(route).not_to be_valid
    expect(route.errors[:route_confidence]).to include("must be less than or equal to 1")
  end
end
