require "rails_helper"

RSpec.describe "Api push subscriptions", type: :request do
  PUSH_AUTH_ENV = {
    "APP_SHARED_SECRET" => "correct-passphrase",
    "SESSION_SECRET" => "session-signing-secret",
    "WORKER_SERVICE_TOKEN" => "worker-service-token",
    "VAPID_PUBLIC_KEY" => "public-vapid-key",
    "VAPID_PRIVATE_KEY" => "private-vapid-key",
    "VAPID_SUBJECT" => "mailto:owner@example.com"
  }.freeze

  around do |example|
    original_env = PUSH_AUTH_ENV.keys.to_h { |key| [ key, ENV[key] ] }
    PUSH_AUTH_ENV.each { |key, value| ENV[key] = value }

    example.run
  ensure
    original_env.each do |key, value|
      value.nil? ? ENV.delete(key) : ENV[key] = value
    end
  end

  def sign_in!
    post "/api/session", params: { passphrase: "correct-passphrase" }
    expect(response).to have_http_status(:ok)
  end

  def subscription_payload(endpoint: "https://push.example/subscriptions/1")
    {
      subscription: {
        endpoint: endpoint,
        expirationTime: 1_787_760_000_000,
        keys: {
          p256dh: "browser-p256dh-key",
          auth: "browser-auth-key"
        }
      }
    }
  end

  describe "GET /api/push/vapid_public_key" do
    it "returns the public VAPID key without requiring a session" do
      get "/api/push/vapid_public_key"

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("vapid_public_key" => "public-vapid-key")
    end
  end

  describe "POST /api/push_subscription" do
    it "stores a browser push subscription for an authenticated owner" do
      sign_in!

      expect do
        post "/api/push_subscription", params: subscription_payload
      end.to change(PushSubscription, :count).by(1)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      subscription = PushSubscription.sole

      expect(body.dig("push_subscription", "id")).to eq(subscription.id)
      expect(subscription.endpoint).to eq("https://push.example/subscriptions/1")
      expect(subscription.p256dh_key).to eq("browser-p256dh-key")
      expect(subscription.auth_key).to eq("browser-auth-key")
      expect(subscription.content_encoding).to eq("aes128gcm")
      expect(subscription.expires_at).to eq(Time.zone.at(1_787_760_000))
    end

    it "updates an existing endpoint instead of creating a duplicate" do
      sign_in!
      PushSubscription.create!(
        endpoint: "https://push.example/subscriptions/1",
        p256dh_key: "old-key",
        auth_key: "old-auth",
      )

      expect do
        post "/api/push_subscription", params: subscription_payload
      end.not_to change(PushSubscription, :count)

      expect(response).to have_http_status(:created)
      expect(PushSubscription.sole.p256dh_key).to eq("browser-p256dh-key")
    end

    it "requires authentication" do
      post "/api/push_subscription", params: subscription_payload

      expect(response).to have_http_status(:unauthorized)
      expect(PushSubscription.count).to eq(0)
    end
  end

  describe "DELETE /api/push_subscription" do
    it "removes the matching subscription for an authenticated owner" do
      sign_in!
      PushSubscription.create!(
        endpoint: "https://push.example/subscriptions/1",
        p256dh_key: "browser-p256dh-key",
        auth_key: "browser-auth-key",
      )

      expect do
        delete "/api/push_subscription", params: { endpoint: "https://push.example/subscriptions/1" }
      end.to change(PushSubscription, :count).by(-1)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("status" => "ok")
    end

    it "requires authentication" do
      PushSubscription.create!(
        endpoint: "https://push.example/subscriptions/1",
        p256dh_key: "browser-p256dh-key",
        auth_key: "browser-auth-key",
      )

      delete "/api/push_subscription", params: { endpoint: "https://push.example/subscriptions/1" }

      expect(response).to have_http_status(:unauthorized)
      expect(PushSubscription.count).to eq(1)
    end
  end
end
