require "rails_helper"

RSpec.describe PostingMetadataFetcher do
  # Namespaced to avoid colliding with the fake transports defined in the
  # OpenRouter/Resend client specs (RSpec loads all specs in one process).
  class MetadataFakeResponse
    attr_reader :code, :body

    def initialize(code, body, headers = {})
      @code = code.to_s
      @body = body
      @headers = headers
    end

    def [](key) = @headers[key]
  end

  # Serves canned responses keyed by request URL so no spec touches the network.
  class MetadataFakeTransport
    attr_reader :requested

    def initialize(responses)
      @responses = responses
      @requested = []
    end

    def request(uri, _request)
      @requested << uri.to_s
      @responses.fetch(uri.to_s) { MetadataFakeResponse.new(404, "") }
    end
  end

  def html_response(body) = MetadataFakeResponse.new(200, body)
  def json_response(payload) = MetadataFakeResponse.new(200, JSON.generate(payload))

  # Specs use public-looking hostnames but must never perform a real DNS lookup,
  # so the address guard is stubbed open by default and re-enabled where it is
  # the thing under test.
  before { allow_any_instance_of(described_class).to receive(:public_address?).and_return(true) }

  describe "input guarding" do
    it "rejects a non-HTTP URL without fetching" do
      transport = MetadataFakeTransport.new({})

      result = described_class.new("ftp://example.com/job", http: transport).call

      expect(result.status).to eq("unsupported")
      expect(transport.requested).to be_empty
    end

    it "rejects a blank URL without fetching" do
      transport = MetadataFakeTransport.new({})

      result = described_class.new("", http: transport).call

      expect(result.status).to eq("unsupported")
      expect(transport.requested).to be_empty
    end

    it "refuses to fetch an address that resolves into a private range" do
      allow_any_instance_of(described_class).to receive(:public_address?).and_call_original
      transport = MetadataFakeTransport.new({})

      result = described_class.new("http://127.0.0.1/jobs/1", http: transport).call

      expect(result.status).to eq("unsupported")
      expect(transport.requested).to be_empty
    end
  end

  describe "LinkedIn" do
    let(:guest_html) do
      <<~HTML
        <h2 class="top-card-layout__title topcard__title">MCP/AI Developer</h2>
        <a class="topcard__org-name-link topcard__flavor--black-link" href="https://www.linkedin.com/company/autodesk">
          Autodesk
        </a>
        <span class="topcard__flavor topcard__flavor--bullet">Canada</span>
        <div class="show-more-less-html__markup relative">
          <p>Build the <strong>agentic</strong> platform.</p><ul><li>Ruby</li></ul>
        </div>
        <section class="similar-jobs">ignored</section>
      HTML
    end

    it "reads the public guest top card for a signed-in job URL" do
      transport = MetadataFakeTransport.new(
        "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4435267449" => html_response(guest_html)
      )

      result = described_class.new(
        "https://www.linkedin.com/jobs/view/4435267449/?alternateChannel=search&trackingId=abc",
        http: transport
      ).call

      expect(result).to be_ok
      expect(result.provider).to eq("linked_in")
      expect(result.title).to eq("MCP/AI Developer")
      expect(result.company).to eq("Autodesk")
      expect(result.location).to eq("Canada")
      expect(result.description).to include("Build the agentic platform.").and include("• Ruby")
      expect(result.description).not_to include("ignored")
    end

    it "maps a forwarded /comm/ job URL onto the same guest endpoint" do
      transport = MetadataFakeTransport.new(
        "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/999" => html_response(guest_html)
      )

      result = described_class.new("https://www.linkedin.com/comm/jobs/view/999", http: transport).call

      expect(result).to be_ok
      expect(transport.requested).to eq([ "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/999" ])
    end
  end

  describe "Greenhouse" do
    it "reads the public board API, which carries the company name the page only implies" do
      transport = MetadataFakeTransport.new(
        "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs/5183044008" => json_response(
          "title" => "AI Safety Fellow",
          "company_name" => "Anthropic",
          "location" => { "name" => "San Francisco, CA" },
          "content" => "&lt;p&gt;Research &amp;amp; engineering.&lt;/p&gt;"
        )
      )

      result = described_class.new("https://job-boards.greenhouse.io/anthropic/jobs/5183044008", http: transport).call

      expect(result).to be_ok
      expect(result.provider).to eq("greenhouse")
      expect(result.title).to eq("AI Safety Fellow")
      expect(result.company).to eq("Anthropic")
      expect(result.location).to eq("San Francisco, CA")
      expect(result.description).to eq("Research & engineering.")
    end
  end

  describe "Lever" do
    it "reads the public postings API" do
      transport = MetadataFakeTransport.new(
        "https://api.lever.co/v0/postings/acme/abc-123-def-4567" => json_response(
          "text" => "Staff Engineer",
          "categories" => { "location" => "Vancouver, BC" },
          "descriptionPlain" => "Own the platform."
        )
      )

      result = described_class.new("https://jobs.lever.co/acme/abc-123-def-4567", http: transport).call

      expect(result).to be_ok
      expect(result.title).to eq("Staff Engineer")
      expect(result.company).to eq("Acme")
      expect(result.location).to eq("Vancouver, BC")
    end
  end

  describe "Ashby" do
    it "matches the job id against the board's posting API" do
      transport = MetadataFakeTransport.new(
        "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true" => json_response(
          "jobs" => [
            { "id" => "00000000-0000-0000-0000-000000000001", "title" => "Other" },
            {
              "id" => "7458d4e9-da2e-47bd-98cb-adfda43d42b2",
              "title" => "Engineering Manager",
              "location" => "Remote",
              "compensation" => { "compensationTierSummary" => "$180K – $220K" },
              "descriptionPlain" => "Lead the team."
            }
          ]
        )
      )

      result = described_class.new(
        "https://jobs.ashbyhq.com/acme/7458d4e9-da2e-47bd-98cb-adfda43d42b2",
        http: transport
      ).call

      expect(result).to be_ok
      expect(result.title).to eq("Engineering Manager")
      expect(result.company).to eq("Acme")
      expect(result.compensation).to eq("$180K – $220K")
    end
  end

  describe "generic pages" do
    it "prefers schema.org JobPosting JSON-LD" do
      html = <<~HTML
        <html><head>
        <title>Careers</title>
        <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"JobPosting","title":"Backend Engineer",
         "hiringOrganization":{"@type":"Organization","name":"Globex"},
         "jobLocation":{"address":{"addressLocality":"Calgary","addressRegion":"AB"}},
         "baseSalary":{"currency":"CAD","value":{"minValue":"120000","maxValue":"150000","unitText":"YEAR"}},
         "description":"<p>Ship services.</p>"}
        </script>
        </head></html>
      HTML
      transport = MetadataFakeTransport.new("https://careers.globex.com/jobs/7" => html_response(html))

      result = described_class.new("https://careers.globex.com/jobs/7", http: transport).call

      expect(result).to be_ok
      expect(result.provider).to eq("generic")
      expect(result.title).to eq("Backend Engineer")
      expect(result.company).to eq("Globex")
      expect(result.location).to eq("Calgary, AB")
      expect(result.compensation).to eq("CAD 120000–150000 year")
      expect(result.description).to eq("Ship services.")
    end

    it "falls back to the document title's conventional shape" do
      html = "<html><head><title>Job Application for Data Engineer at Initech</title></head></html>"
      transport = MetadataFakeTransport.new("https://apply.initech.com/jobs/3" => html_response(html))

      result = described_class.new("https://apply.initech.com/jobs/3", http: transport).call

      expect(result).to be_ok
      expect(result.title).to eq("Data Engineer")
      expect(result.company).to eq("Initech")
    end

    it "follows a bounded redirect chain" do
      transport = MetadataFakeTransport.new(
        "https://jobs.example.com/1" => MetadataFakeResponse.new(302, "", "location" => "https://jobs.example.com/2"),
        "https://jobs.example.com/2" => html_response("<title>Dev at Acme</title>")
      )

      result = described_class.new("https://jobs.example.com/1", http: transport).call

      expect(result.title).to eq("Dev")
      expect(result.company).to eq("Acme")
    end
  end

  describe "failures" do
    it "returns an unavailable result rather than raising when the page cannot be read" do
      transport = MetadataFakeTransport.new({})

      result = described_class.new("https://jobs.example.com/missing", http: transport).call

      expect(result.status).to eq("unavailable")
      expect(result).not_to be_ok
      expect(result.error).to be_present
    end

    it "returns an unavailable result on a transport failure" do
      transport = Class.new do
        def request(_uri, _request) = raise Errno::ECONNREFUSED
      end.new

      result = described_class.new("https://jobs.example.com/1", http: transport).call

      expect(result.status).to eq("unavailable")
    end

    it "never falls back to the LLM" do
      allow(OpenrouterClient).to receive(:new).and_raise("LLM must not be used for posting metadata")
      transport = MetadataFakeTransport.new({})

      expect { described_class.new("https://jobs.example.com/1", http: transport).call }.not_to raise_error
    end
  end
end
