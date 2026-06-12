require "rails_helper"

RSpec.describe DailyDigestJob, type: :job do
  # Fake push transport: records what it would send and never touches the
  # network. Mirrors WebPushDispatcher::WebPushTransport#deliver's contract.
  class FakePushTransport
    attr_reader :deliveries

    def initialize
      @deliveries = []
    end

    def deliver(message:, endpoint:, p256dh:, auth:, vapid:)
      @deliveries << { message: message, endpoint: endpoint, p256dh: p256dh, auth: auth, vapid: vapid }
    end
  end

  def scored_post(attrs = {})
    company = Company.find_or_create_by!(name: attrs.delete(:company) || "Acme Corp")
    JobPost.create!(
      {
        company: company,
        title: "Senior Backend Engineer",
        scoring_status: "scored",
        match_score: 82,
        scored_at: 1.hour.ago
      }.merge(attrs)
    )
  end

  def subscription(endpoint: "https://push.example.com/abc")
    PushSubscription.create!(
      endpoint: endpoint,
      p256dh_key: "p256dh",
      auth_key: "auth",
      content_encoding: "aes128gcm"
    )
  end

  around do |example|
    ENV["VAPID_PUBLIC_KEY"] = "pub"
    ENV["VAPID_PRIVATE_KEY"] = "priv"
    example.run
  ensure
    ENV.delete("VAPID_PUBLIC_KEY")
    ENV.delete("VAPID_PRIVATE_KEY")
  end

  describe "DailyDigestBuilder" do
    it "selects recently scored posts and builds a notification payload" do
      scored_post(title: "Top Role", match_score: 90)
      scored_post(title: "Stale Role", scored_at: 5.days.ago)

      payload = DailyDigestBuilder.new.call

      expect(payload[:title]).to eq("1 new job match")
      expect(payload[:body]).to include("Top Role")
      expect(payload[:body]).not_to include("Stale Role")
      expect(payload[:data][:count]).to eq(1)
    end

    it "returns nil when there is nothing recently scored" do
      scored_post(scored_at: 3.days.ago)
      expect(DailyDigestBuilder.new.call).to be_nil
    end

    it "ignores unscored posts" do
      scored_post(scoring_status: "pending", match_score: nil)
      expect(DailyDigestBuilder.new.call).to be_nil
    end
  end

  describe "dispatch with a mocked push transport" do
    it "delivers the digest to every stored subscription using VAPID" do
      scored_post
      subscription(endpoint: "https://push.example.com/one")
      subscription(endpoint: "https://push.example.com/two")
      transport = FakePushTransport.new

      result = WebPushDispatcher.new(transport: transport).deliver_all(DailyDigestBuilder.new.call)

      expect(result).to be_sent
      expect(transport.deliveries.size).to eq(2)
      expect(transport.deliveries.first[:vapid]).to include(public_key: "pub", private_key: "priv")
    end

    it "prunes subscriptions that the push service reports as gone" do
      scored_post
      subscription(endpoint: "https://push.example.com/dead")
      transport = FakePushTransport.new
      gone = WebPush::ExpiredSubscription.new(double(code: "410", message: "Gone", body: ""), "host")
      allow(transport).to receive(:deliver).and_raise(gone)

      result = WebPushDispatcher.new(transport: transport).deliver_all({ title: "x" })

      expect(result.pruned).to eq(1)
      expect(PushSubscription.count).to eq(0)
    end
  end

  describe "guards" do
    it "no-ops with no VAPID key configured" do
      ENV.delete("VAPID_PUBLIC_KEY")
      ENV.delete("VAPID_PRIVATE_KEY")
      subscription
      transport = FakePushTransport.new

      result = WebPushDispatcher.new(transport: transport).deliver_all({ title: "x" })

      expect(result).to be_skipped
      expect(transport.deliveries).to be_empty
    end

    it "no-ops with no subscriptions" do
      transport = FakePushTransport.new

      result = WebPushDispatcher.new(transport: transport).deliver_all({ title: "x" })

      expect(result).to be_skipped
      expect(transport.deliveries).to be_empty
    end
  end

  describe "DailyDigestJob end to end" do
    it "builds and dispatches without sending a real push" do
      scored_post
      subscription
      transport = FakePushTransport.new
      allow(WebPushDispatcher).to receive(:new).and_return(WebPushDispatcher.new(transport: transport))

      expect { described_class.perform_now }.not_to raise_error
      expect(transport.deliveries.size).to eq(1)
    end

    it "no-ops when there is no digest content" do
      subscription
      transport = FakePushTransport.new
      allow(WebPushDispatcher).to receive(:new).and_return(WebPushDispatcher.new(transport: transport))

      expect { described_class.perform_now }.not_to raise_error
      expect(transport.deliveries).to be_empty
    end
  end
end
