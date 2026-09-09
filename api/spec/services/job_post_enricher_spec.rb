require "rails_helper"

RSpec.describe JobPostEnricher do
  # Stands in for PostingMetadataFetcher so no spec touches the network.
  class FakeMetadataFetcher
    attr_reader :calls

    def initialize(result)
      @result = result
      @calls = 0
    end

    def call
      @calls += 1
      @result
    end
  end

  def metadata(**fields)
    PostingMetadataFetcher::Result.new(status: "ok", provider: "linked_in", **fields)
  end

  def unavailable
    PostingMetadataFetcher::Result.new(status: "unavailable", error: "nope")
  end

  # Mirrors what ManualJobPostImporter writes for a URL-only manual entry: the
  # title and company are both the humanized URL host.
  def placeholder_post(url: "https://www.linkedin.com/jobs/view/4435267449/?trk=x", **overrides)
    JobPost.create!(
      {
        company: Company.find_or_create_by!(name: "Linkedin"),
        title: "Linkedin",
        posting_url: url,
        source_url: url,
        source: "manual",
        scoring_status: "pending"
      }.merge(overrides)
    )
  end

  it "replaces host-derived title and company placeholders with the posting's own values" do
    job_post = placeholder_post
    fetcher = FakeMetadataFetcher.new(
      metadata(title: "MCP/AI Developer", company: "Autodesk", location: "Canada", description: "Build it.")
    )

    result = described_class.new(job_post, fetcher: fetcher).call

    expect(result).to be_updated
    expect(result.updated_fields).to match_array(%w[title company location description])
    job_post.reload
    expect(job_post.title).to eq("MCP/AI Developer")
    expect(job_post.company.name).to eq("Autodesk")
    expect(job_post.location).to eq("Canada")
    expect(job_post.description).to eq("Build it.")
  end

  it "never overwrites a title or company the owner supplied" do
    job_post = placeholder_post(title: "Owner's title")
    job_post.update!(
      company: Company.find_or_create_by!(name: "Owner's company"),
      source_payload: { "manual_entry" => { "title_provided" => true, "company_provided" => true } }
    )
    fetcher = FakeMetadataFetcher.new(metadata(title: "Fetched title", company: "Fetched company"))

    result = described_class.new(job_post, fetcher: fetcher).call

    expect(result.status).to eq("unchanged")
    job_post.reload
    expect(job_post.title).to eq("Owner's title")
    expect(job_post.company.name).to eq("Owner's company")
  end

  it "leaves a real title alone while still filling the placeholder company" do
    job_post = placeholder_post(title: "Senior Platform Engineer")

    result = described_class.new(
      job_post,
      fetcher: FakeMetadataFetcher.new(metadata(title: "Fetched title", company: "Autodesk"))
    ).call

    expect(result.updated_fields).to eq(%w[company])
    job_post.reload
    expect(job_post.title).to eq("Senior Platform Engineer")
    expect(job_post.company.name).to eq("Autodesk")
  end

  it "does not overwrite a description that is already present" do
    job_post = placeholder_post(description: "Pasted posting text")

    described_class.new(
      job_post,
      fetcher: FakeMetadataFetcher.new(metadata(title: "Dev", company: "Acme", description: "Fetched body"))
    ).call

    expect(job_post.reload.description).to eq("Pasted posting text")
  end

  it "reports unavailable without changing the record when the posting cannot be read" do
    job_post = placeholder_post

    result = described_class.new(job_post, fetcher: FakeMetadataFetcher.new(unavailable)).call

    expect(result.status).to eq("unavailable")
    expect(job_post.reload.title).to eq("Linkedin")
  end

  it "skips without fetching when the post has no URL" do
    job_post = placeholder_post(posting_url: nil, source_url: nil)
    fetcher = FakeMetadataFetcher.new(metadata(title: "Dev"))

    result = described_class.new(job_post, fetcher: fetcher).call

    expect(result.status).to eq("skipped")
    expect(fetcher.calls).to eq(0)
  end

  it "never calls the LLM" do
    allow(OpenrouterClient).to receive(:new).and_raise("LLM must not be used for enrichment")
    job_post = placeholder_post

    expect do
      described_class.new(job_post, fetcher: FakeMetadataFetcher.new(metadata(title: "Dev", company: "Acme"))).call
    end.not_to raise_error
  end
end
