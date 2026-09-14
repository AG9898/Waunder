require "rails_helper"

RSpec.describe InboundPostingTitleFilter do
  it "returns accepted postings and an auditable aggregate rejection summary" do
    software = { title: "Software Engineer", company: "Acme" }
    result = described_class.call([
      software,
      { title: "Data Scientist", company: "Data Co" },
      { title: "Product Manager", company: "Product Co" }
    ])

    expect(result.accepted_postings).to eq([ software ])
    expect(result.summary).to eq(
      "policy" => JobPostTitleScreen::POLICY_VERSION,
      "candidates" => 3,
      "accepted" => 1,
      "rejected" => 2,
      "reasons" => {
        "title_matches_exclusion" => 1,
        "title_missing_target_role" => 1
      }
    )
  end
end
