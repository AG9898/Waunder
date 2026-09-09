require "rails_helper"

RSpec.describe CoverLetterDraft, type: :model do
  let(:company) { Company.create!(name: "Acme") }
  let(:job_post) { JobPost.create!(company:, title: "Platform Engineer") }

  it "belongs to a job post and persists its body encrypted at rest" do
    draft = described_class.create!(
      job_post:,
      body: "Dear Acme team, I am excited to apply.",
      generated_at: Time.current
    )

    raw = ActiveRecord::Base.connection.select_one(
      "SELECT body FROM cover_letter_drafts WHERE id = #{draft.id}"
    )

    expect(raw["body"]).not_to include("Dear Acme team")
    expect(described_class.find(draft.id).body).to eq("Dear Acme team, I am excited to apply.")
    expect(job_post.reload.cover_letter_draft).to eq(draft)
  end

  it "allows only one current draft per job post" do
    described_class.create!(job_post:, body: "First letter", generated_at: Time.current)

    duplicate = described_class.new(job_post:, body: "Second letter", generated_at: Time.current)
    expect { duplicate.save! }.to raise_error(ActiveRecord::RecordNotUnique)
  end
end
