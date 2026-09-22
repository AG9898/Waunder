require "rails_helper"

RSpec.describe InboundEmailParsers::Glassdoor do
  def parse(text:, subject: "")
    described_class.new(text: text, html: "", subject: subject).parse
  end

  describe "company-insights email (\"<Company>: What You Need to Know\")" do
    # Sanitized copy of a real production body: research-section preamble,
    # NBSPs, bracketed links, logo+link lines, and rated/unrated job blocks
    # are preserved; the owner's address and tracking tokens are dummies.
    let(:fixture) { file_fixture("inbound_emails/glassdoor_company_insights.txt").read }
    let(:expected) do
      [
        [ "Definity", "Specialist, AI Engineering", "Toronto", "1010097188471" ],
        [ "Gatekeeper Systems (Canada)", "Software Engineer", "Abbotsford", "1009899169893" ],
        [ "Hatch", "Senior Golang Backend Engineer - Electronic Arts [EAG260818]", "British Columbia", "1010234224557" ],
        [ "Vista Solutions", "Machine Vision Engineer", "Canada", "1010235202253" ],
        [ "Area52", "Application Engineer", "Moncton", "1010256382700" ]
      ]
    end

    def summarize(postings)
      postings.map do |p|
        [ p[:company], p[:title], p[:location], p[:posting_url][/\?jl=(\d+)\z/, 1] ]
      end
    end

    it "extracts only the 'Check out these jobs' postings, detected by subject" do
      postings = parse(text: fixture, subject: "Spot Solutions Ltd: What You Need to Know")

      expect(summarize(postings)).to eq(expected)
      expect(postings.map { |p| p[:posting_url] }).to all(start_with("https://www.glassdoor.ca/job-listing/index.htm?jl="))
      expect(postings.map { |p| p[:source_url] }).to all(include("partner/jobListing.htm"))
      expect(postings.map { |p| p[:source] }).to all(eq("glassdoor"))
    end

    it "detects the variant from the body marker when the subject is absent" do
      expect(summarize(parse(text: fixture))).to eq(expected)
    end

    it "never emits a rating, a 'Company - Location' pair, or a research-section posting" do
      postings = parse(text: fixture)

      expect(postings.map { |p| p[:company] }).to all(satisfy { |c| !c.include?("★") })
      expect(postings.map { |p| p[:location] }).to all(satisfy { |l| !l.include?(" - ") })
      research_ids = %w[1010251122709 1010256446057]
      expect(postings.map { |p| p[:posting_url] }).to all(satisfy { |u| research_ids.none? { |id| u.include?(id) } })
      expect(postings.map { |p| p[:title] }).not_to include(a_string_matching(/Full Stack|Agentic AI/))
    end

    it "keeps a hyphenated company name whole by cross-checking the company line" do
      nbsp = "\u00A0"
      text = <<~TEXT
        Keep Applying!
        Check out these jobs

        Hughes - Baker Engineering
        [https://media.glassdoor.com/sql/1/logo.png]https://www.glassdoor.ca/partner/jobListing.htm?pos=104&jobListingId=1010193152138[https://www.glassdoor.ca/brand-views?o=brandview-pixel&p=x]

        4.0 ★

        Machine Shop Lead Hand - Level 1

        Hughes - Baker Engineering#{nbsp}-#{nbsp}Edmonton

        Easy Apply

        [https://www.glassdoor.ca/partner/jobListing.htm?pos=104&jobListingId=1010193152138]
      TEXT

      posting = parse(text: text).sole

      expect(posting[:company]).to eq("Hughes - Baker Engineering")
      expect(posting[:title]).to eq("Machine Shop Lead Hand - Level 1")
      expect(posting[:location]).to eq("Edmonton")
      expect(posting[:posting_url]).to eq("https://www.glassdoor.ca/job-listing/index.htm?jl=1010193152138")
    end
  end

  describe "listing id canonicalization" do
    it "canonicalizes a job-listing slug link by its jl= id" do
      text = <<~TEXT
        Product Manager
        Initech — Remote, US
        https://www.glassdoor.ca/job-listing/product-manager-initech-JV_KO0,15.htm?jl=1010000000001&utm_medium=email
      TEXT

      posting = parse(text: text).sole

      expect(posting[:posting_url]).to eq("https://www.glassdoor.ca/job-listing/index.htm?jl=1010000000001")
    end
  end
end
