require "rails_helper"

RSpec.describe OpenrouterClient do
  # Fake transport: records the request and returns a canned HTTP response
  # without ever touching the network.
  class FakeResponse
    attr_reader :code, :body

    def initialize(code, body)
      @code = code.to_s
      @body = body
    end
  end

  class FakeTransport
    attr_reader :requests

    def initialize(responses)
      @responses = Array(responses)
      @requests = []
    end

    def request(_uri, request)
      @requests << request
      @responses.shift || raise("no more canned responses")
    end
  end

  def completion(content)
    JSON.generate("choices" => [ { "message" => { "content" => content } } ])
  end

  describe "API key guarding" do
    it "raises a typed error when the API key is absent" do
      expect { described_class.new(api_key: nil) }
        .to raise_error(OpenrouterClient::MissingApiKeyError)
    end

    it "raises a typed error for a blank API key" do
      expect { described_class.new(api_key: "   ") }
        .to raise_error(OpenrouterClient::MissingApiKeyError)
    end

    it "does not raise when a key is present" do
      expect { described_class.new(api_key: "sk-test") }.not_to raise_error
    end
  end

  describe "model selection" do
    it "defaults to the configured low-cost model when env is unset" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("OPENROUTER_MODEL").and_return(nil)

      client = described_class.new(api_key: "sk-test")
      expect(client.model).to eq("google/gemini-2.5-flash-lite")
    end

    it "uses OPENROUTER_MODEL from env when set" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("OPENROUTER_MODEL").and_return("anthropic/claude-3-haiku")

      client = described_class.new(api_key: "sk-test")
      expect(client.model).to eq("anthropic/claude-3-haiku")
    end

    it "lets an explicit model argument override env" do
      client = described_class.new(api_key: "sk-test", model: "meta/llama-3")
      expect(client.model).to eq("meta/llama-3")
    end
  end

  describe "#complete_json structured parsing" do
    it "parses a clean JSON object completion" do
      transport = FakeTransport.new(FakeResponse.new(200, completion('{"score":7,"reason":"fit"}')))
      client = described_class.new(api_key: "sk-test", http: transport)

      result = client.complete_json([ { role: "user", content: "score this" } ])

      expect(result).to eq("score" => 7, "reason" => "fit")
    end

    it "sends the configured model and a JSON response_format" do
      transport = FakeTransport.new(FakeResponse.new(200, completion('{"ok":true}')))
      client = described_class.new(api_key: "sk-test", model: "meta/llama-3", http: transport)

      client.complete_json([ { role: "user", content: "hi" } ])

      body = JSON.parse(transport.requests.first.body)
      expect(body["model"]).to eq("meta/llama-3")
      expect(body.dig("response_format", "type")).to eq("json_object")
    end

    it "sends a bearer authorization header" do
      transport = FakeTransport.new(FakeResponse.new(200, completion('{"ok":true}')))
      client = described_class.new(api_key: "sk-secret", http: transport)

      client.complete_json([ { role: "user", content: "hi" } ])

      expect(transport.requests.first["Authorization"]).to eq("Bearer sk-secret")
    end
  end

  describe "parse fallback" do
    it "recovers JSON wrapped in prose / code fences" do
      content = "Sure! Here is the result:\n```json\n{\"score\": 4}\n```\nHope that helps."
      transport = FakeTransport.new(FakeResponse.new(200, completion(content)))
      client = described_class.new(api_key: "sk-test", http: transport)

      expect(client.complete_json([ { role: "user", content: "x" } ])).to eq("score" => 4)
    end

    it "recovers a JSON array embedded in text" do
      content = "Results: [{\"id\":1},{\"id\":2}] done"
      transport = FakeTransport.new(FakeResponse.new(200, completion(content)))
      client = described_class.new(api_key: "sk-test", http: transport)

      expect(client.complete_json([ { role: "user", content: "x" } ]))
        .to eq([ { "id" => 1 }, { "id" => 2 } ])
    end

    it "does not mis-split on braces inside strings" do
      content = 'prefix {"note":"a } b","ok":true} suffix'
      transport = FakeTransport.new(FakeResponse.new(200, completion(content)))
      client = described_class.new(api_key: "sk-test", http: transport)

      expect(client.complete_json([ { role: "user", content: "x" } ]))
        .to eq("note" => "a } b", "ok" => true)
    end

    it "raises ResponseError when no JSON can be recovered" do
      transport = FakeTransport.new(FakeResponse.new(200, completion("totally not json")))
      client = described_class.new(api_key: "sk-test", http: transport)

      expect { client.complete_json([ { role: "user", content: "x" } ]) }
        .to raise_error(OpenrouterClient::ResponseError)
    end
  end

  describe "retry / graceful degradation" do
    it "retries on a 429 rate-limit then succeeds" do
      transport = FakeTransport.new([
        FakeResponse.new(429, "rate limited"),
        FakeResponse.new(200, completion('{"ok":true}'))
      ])
      client = described_class.new(api_key: "sk-test", http: transport)

      expect(client.complete_json([ { role: "user", content: "x" } ])).to eq("ok" => true)
      expect(transport.requests.size).to eq(2)
    end

    it "raises RequestError after exhausting retries" do
      transport = FakeTransport.new([
        FakeResponse.new(503, "down"),
        FakeResponse.new(503, "down"),
        FakeResponse.new(503, "down")
      ])
      client = described_class.new(api_key: "sk-test", max_retries: 2, http: transport)

      expect { client.complete_json([ { role: "user", content: "x" } ]) }
        .to raise_error(OpenrouterClient::RequestError)
    end

    it "raises RequestError on a non-retryable status without retrying" do
      transport = FakeTransport.new([ FakeResponse.new(400, "bad request") ])
      client = described_class.new(api_key: "sk-test", http: transport)

      expect { client.complete_json([ { role: "user", content: "x" } ]) }
        .to raise_error(OpenrouterClient::RequestError)
      expect(transport.requests.size).to eq(1)
    end
  end

  describe "PII safety" do
    it "never logs prompt or completion contents" do
      logged = []
      allow(Rails.logger).to receive(:info) { |msg| logged << msg }

      transport = FakeTransport.new([
        FakeResponse.new(429, "rate limited"),
        FakeResponse.new(200, completion('{"secret":"jane@example.com"}'))
      ])
      client = described_class.new(api_key: "sk-secret", http: transport)
      client.complete_json([ { role: "user", content: "resume of Jane Doe, SSN 111" } ])

      joined = logged.join("\n")
      expect(joined).not_to include("Jane Doe")
      expect(joined).not_to include("jane@example.com")
      expect(joined).not_to include("sk-secret")
    end
  end
end
