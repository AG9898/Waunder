require "rails_helper"

RSpec.describe IngestionBatchBuilder do
  def post_at(time, source:, company:, title:, score: nil)
    JobPost.create!(
      company: company,
      title: title,
      source: source,
      match_score: score,
      scoring_status: score ? "scored" : "pending"
    ).tap { |p| p.update_column(:created_at, time) }
  end

  let(:company) { Company.create!(name: "Acme") }
  let(:now) { Time.utc(2026, 6, 23, 12, 0, 0) }

  it "groups same-source postings created within the gap into one batch" do
    post_at(now - 30.seconds, source: "linkedin", company: company, title: "A", score: 80)
    post_at(now - 29.seconds, source: "linkedin", company: company, title: "B", score: 60)
    post_at(now - 28.seconds, source: "linkedin", company: company, title: "C")

    batches = described_class.new(now: now).call

    expect(batches.size).to eq(1)
    batch = batches.first
    expect(batch[:source]).to eq("linkedin")
    expect(batch[:count]).to eq(3)
    expect(batch[:date]).to eq(now.to_date.iso8601)
    # ingested_at is the latest arrival in the cluster.
    expect(batch[:ingested_at]).to eq(now - 28.seconds)
    # Jobs are ranked by match_score desc (nil last).
    expect(batch[:jobs].map { |j| j[:title] }).to eq(%w[A B C])
  end

  it "starts a new batch when the same-source gap exceeds GAP" do
    post_at(now - 10.minutes, source: "linkedin", company: company, title: "Old")
    post_at(now - 9.minutes - 30.seconds, source: "linkedin", company: company, title: "Old2")
    post_at(now - 1.minute, source: "linkedin", company: company, title: "New")

    batches = described_class.new(now: now).call

    expect(batches.size).to eq(2)
    # Newest first.
    expect(batches.first[:jobs].map { |j| j[:title] }).to eq(%w[New])
    expect(batches.last[:jobs].map { |j| j[:title] }).to eq(%w[Old Old2])
  end

  it "separates concurrent postings from different sources into different batches" do
    post_at(now - 30.seconds, source: "linkedin", company: company, title: "LI")
    post_at(now - 29.seconds, source: "glassdoor", company: company, title: "GD")

    batches = described_class.new(now: now).call

    expect(batches.size).to eq(2)
    expect(batches.map { |b| b[:source] }).to contain_exactly("linkedin", "glassdoor")
  end

  it "ignores postings older than the window" do
    post_at(now - 200.days, source: "linkedin", company: company, title: "Ancient")
    post_at(now - 1.minute, source: "linkedin", company: company, title: "Recent")

    batches = described_class.new(now: now).call

    expect(batches.flat_map { |b| b[:jobs].map { |j| j[:title] } }).to eq(%w[Recent])
  end

  it "returns an empty array when there are no postings" do
    expect(described_class.new(now: now).call).to eq([])
  end

  it "exposes a stable id derived from source and first arrival" do
    post_at(now - 30.seconds, source: "glassdoor", company: company, title: "A")

    batch = described_class.new(now: now).call.first

    expect(batch[:id]).to eq("glassdoor-#{(now - 30.seconds).to_i}")
  end
end
