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
end
