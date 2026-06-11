require "rails_helper"

RSpec.describe ContactCandidate, type: :model do
  it "requires a job post, name, and relevance reason" do
    contact_candidate = described_class.new(name: "", relevance_reason: "")

    expect(contact_candidate).not_to be_valid
    expect(contact_candidate.errors[:job_post]).to include("must exist")
    expect(contact_candidate.errors[:name]).to include("can't be blank")
    expect(contact_candidate.errors[:relevance_reason]).to include("can't be blank")
  end

  it "links to a job post and owns outreach drafts" do
    company = Company.create!(name: "Example Co")
    job_post = company.job_posts.create!(title: "Product Engineer")
    contact_candidate = described_class.create!(
      job_post:,
      name: "Ada Lovelace",
      title: "Engineering Manager",
      company_name: "Example Co",
      linkedin_url: "https://www.linkedin.com/in/ada-lovelace",
      relevance_reason: "Hiring manager for the product engineering team"
    )
    outreach_draft = contact_candidate.outreach_drafts.create!(
      loose_template: "Mention the role and shared product work.",
      message: "Hi Ada, I noticed your team is hiring for Product Engineering."
    )

    expect(job_post.contact_candidates).to contain_exactly(contact_candidate)
    expect(contact_candidate.outreach_drafts).to contain_exactly(outreach_draft)
  end
end
