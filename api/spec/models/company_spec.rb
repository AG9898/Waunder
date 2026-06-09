require "rails_helper"

RSpec.describe Company, type: :model do
  it "requires a name" do
    company = described_class.new(name: "")

    expect(company).not_to be_valid
    expect(company.errors[:name]).to include("can't be blank")
  end

  it "owns job posts without deleting them implicitly" do
    company = described_class.create!(name: "Example Co")
    job_post = company.job_posts.create!(title: "Product Engineer")

    expect(company.job_posts).to contain_exactly(job_post)
  end
end
