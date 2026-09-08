require "rails_helper"

RSpec.describe JobUrlIdentity do
  describe ".key" do
    it "uses the LinkedIn job id for listing and tracking URL variants" do
      urls = [
        "https://www.linkedin.com/jobs/view/4309297029/?trackingId=abc&trk=eml-x",
        "https://www.linkedin.com/comm/jobs/view/4309297029?currentJobId=999&lipi=def"
      ]

      expect(urls.map { |url| described_class.key(url) }.uniq).to eq([ "linkedin:4309297029" ])
    end

    it "removes known tracking parameters while retaining ATS job parameters" do
      key = described_class.key(
        "https://boards.greenhouse.io/acme/jobs/123?gh_jid=123&utm_source=linkedin&department=engineering&gclid=click"
      )

      expect(key).to eq("url:https://boards.greenhouse.io/acme/jobs/123?department=engineering&gh_jid=123")
    end

    it "retains arbitrary generic path, query, and fragment components" do
      key = described_class.key(
        "https://jobs.acme.example/apply/123?job_id=123&ref=engineering&company=acme#role-details"
      )

      expect(key).to eq("url:https://jobs.acme.example/apply/123?company=acme&job_id=123&ref=engineering#role-details")
    end

    it "returns nil for malformed and non-HTTP(S) input" do
      [ nil, "", "not a URL", "ftp://jobs.example.com/123", "mailto:jobs@example.com", "http://[not a url" ].each do |url|
        expect(described_class.key(url)).to be_nil
      end
    end

    it "does not construct an HTTP client or LLM" do
      expect(OpenrouterClient).not_to receive(:new)
      expect(Net::HTTP).not_to receive(:new)

      expect(described_class.key("https://jobs.example.com/123?utm_source=linkedin")).to eq(
        "url:https://jobs.example.com/123"
      )
    end
  end
end
