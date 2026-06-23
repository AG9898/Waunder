require "rails_helper"

RSpec.describe JobPost, type: :model do
  it "requires a company and title" do
    job_post = described_class.new(title: "")

    expect(job_post).not_to be_valid
    expect(job_post.errors[:company]).to include("must exist")
    expect(job_post.errors[:title]).to include("can't be blank")
  end

  it "has one application route" do
    company = Company.create!(name: "Example Co")
    job_post = described_class.create!(company:, title: "Product Engineer")
    route = job_post.create_application_route!(route_type: "greenhouse")

    expect(job_post.application_route).to eq(route)
  end

  it "bounds match score to a percentage" do
    company = Company.create!(name: "Example Co")
    job_post = described_class.new(company:, title: "Product Engineer", match_score: 101)

    expect(job_post).not_to be_valid
    expect(job_post.errors[:match_score]).to include("must be less than or equal to 100")
  end

  it "defaults lifecycle_state to active" do
    company = Company.create!(name: "Example Co")
    job_post = described_class.create!(company:, title: "Product Engineer")

    expect(job_post.lifecycle_state).to eq("active")
  end

  it "rejects an unknown lifecycle_state" do
    company = Company.create!(name: "Example Co")
    job_post = described_class.new(company:, title: "Product Engineer", lifecycle_state: "archived")

    expect(job_post).not_to be_valid
    expect(job_post.errors[:lifecycle_state]).to include("is not included in the list")
  end

  it "scopes by lifecycle_state" do
    company = Company.create!(name: "Example Co")
    active = described_class.create!(company:, title: "Active", lifecycle_state: "active")
    backlog = described_class.create!(company:, title: "Backlog", lifecycle_state: "backlog")
    removed = described_class.create!(company:, title: "Removed", lifecycle_state: "removed")

    expect(described_class.active).to include(active)
    expect(described_class.active).not_to include(backlog, removed)
    expect(described_class.backlog).to contain_exactly(backlog)
    expect(described_class.removed).to contain_exactly(removed)
  end
end
