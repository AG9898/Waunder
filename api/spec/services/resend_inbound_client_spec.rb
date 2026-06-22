require "rails_helper"

RSpec.describe ResendInboundClient do
  # Namespaced to avoid colliding with the top-level FakeResponse/FakeTransport
  # defined in openrouter_client_spec.rb (RSpec loads all specs in one process).
  class ResendFakeResponse
    attr_reader :code, :body

    def initialize(code, body)
      @code = code.to_s
      @body = body
    end
  end

  class ResendFakeTransport
    attr_reader :requests

    def initialize(response)
      @response = response
      @requests = []
    end

    def request(uri, request)
      @requests << [ uri, request ]
      @response
    end
  end

  describe "API key guarding" do
    it "raises a typed error when the API key is absent" do
      expect { described_class.new(api_key: nil) }
        .to raise_error(ResendInboundClient::MissingApiKeyError)
    end

    it "raises a typed error for a blank API key" do
      expect { described_class.new(api_key: "   ") }
        .to raise_error(ResendInboundClient::MissingApiKeyError)
    end
  end

  describe "#fetch" do
    it "GETs the receiving endpoint with bearer auth and returns the parsed body" do
      transport = ResendFakeTransport.new(
        ResendFakeResponse.new(200, JSON.generate("text" => "Body text", "html" => "<p>Body</p>", "from" => "x@y.com"))
      )
      client = described_class.new(api_key: "re_test", http: transport)

      result = client.fetch("abc-123")

      expect(result["text"]).to eq("Body text")
      expect(result["html"]).to eq("<p>Body</p>")

      uri, request = transport.requests.first
      expect(uri.to_s).to eq("https://api.resend.com/emails/receiving/abc-123")
      expect(request["Authorization"]).to eq("Bearer re_test")
    end

    it "raises a RequestError on a non-success status" do
      transport = ResendFakeTransport.new(ResendFakeResponse.new(404, "not found"))
      client = described_class.new(api_key: "re_test", http: transport)

      expect { client.fetch("missing") }.to raise_error(ResendInboundClient::RequestError)
    end

    it "raises a RequestError when email_id is blank" do
      client = described_class.new(api_key: "re_test", http: ResendFakeTransport.new(ResendFakeResponse.new(200, "{}")))
      expect { client.fetch("") }.to raise_error(ResendInboundClient::RequestError)
    end
  end
end
