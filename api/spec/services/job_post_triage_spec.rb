require "rails_helper"

RSpec.describe JobPostTriage do
  def job_post(title:, location: nil)
    company = Company.create!(name: "Acme")
    JobPost.create!(company: company, title: title, location: location, source: "linkedin")
  end

  it "marks target developer roles in Vancouver as eligible" do
    post = job_post(title: "Senior Software Engineer", location: "Vancouver, BC (Hybrid)")

    result = described_class.new(post).call

    expect(result).to be_eligible
    expect(post.reload.triage_status).to eq("eligible")
    expect(post.triage_reasons).to include("title_matches_target_roles", "location_vancouver_priority")
    expect(post.remote_status).to eq("hybrid")
  end

  it "marks AI and machine-learning-adjacent remote roles as eligible" do
    post = job_post(title: "Machine Learning Engineer", location: "Canada (Remote)")

    result = described_class.new(post).call

    expect(result).to be_eligible
    expect(post.reload.triage_reasons).to include("location_remote_priority")
    expect(post.remote_status).to eq("remote")
  end

  it "rejects postings without a target job-title signal" do
    post = job_post(title: "Account Executive", location: "Vancouver, BC")

    result = described_class.new(post).call

    expect(result).to be_rejected
    expect(post.reload.triage_reasons).to include("title_missing_target_role", "title_matches_exclusion")
  end

  it "rejects otherwise relevant roles outside priority locations when not remote" do
    post = job_post(title: "Backend Developer", location: "San Francisco, CA")

    result = described_class.new(post).call

    expect(result).to be_rejected
    expect(post.reload.triage_reasons).to include("location_outside_priority_markets")
  end

  it "allows relevant roles when location is missing" do
    post = job_post(title: "AI Engineer", location: nil)

    result = described_class.new(post).call

    expect(result).to be_eligible
    expect(post.reload.triage_reasons).to include("location_unknown")
  end

  it "allows broad Canada locations as lower-priority location signals" do
    post = job_post(title: "AI / ML Engineer", location: "Canada")

    result = described_class.new(post).call

    expect(result).to be_eligible
    expect(post.reload.triage_reasons).to include("location_broad_canada")
  end

  it "reads a non-negative daily auto-score limit from the environment" do
    original = ENV[described_class::AUTO_SCORE_DAILY_LIMIT_ENV]
    ENV[described_class::AUTO_SCORE_DAILY_LIMIT_ENV] = "-5"

    expect(described_class.auto_score_daily_limit).to eq(0)
  ensure
    original.nil? ? ENV.delete(described_class::AUTO_SCORE_DAILY_LIMIT_ENV) : ENV[described_class::AUTO_SCORE_DAILY_LIMIT_ENV] = original
  end
end
