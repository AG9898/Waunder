require "rails_helper"

RSpec.describe OutreachDraft, type: :model do
  it "requires a contact candidate and message" do
    outreach_draft = described_class.new(message: "")

    expect(outreach_draft).not_to be_valid
    expect(outreach_draft.errors[:contact_candidate]).to include("must exist")
    expect(outreach_draft.errors[:message]).to include("can't be blank")
  end

  it "belongs to a contact candidate" do
    company = Company.create!(name: "Example Co")
    job_post = company.job_posts.create!(title: "Product Engineer")
    contact_candidate = ContactCandidate.create!(
      job_post:,
      name: "Ada Lovelace",
      relevance_reason: "Relevant engineering leader"
    )
    outreach_draft = described_class.create!(
      contact_candidate:,
      loose_template: "Short intro",
      message: "Hi Ada, I am interested in the Product Engineer role."
    )

    expect(outreach_draft.contact_candidate).to eq(contact_candidate)
  end
end
