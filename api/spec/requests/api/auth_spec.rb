require "rails_helper"

RSpec.describe "Api auth", type: :request do
  AUTH_ENV = {
    "APP_SHARED_SECRET" => "correct-passphrase",
    "SESSION_SECRET" => "session-signing-secret",
    "WORKER_SERVICE_TOKEN" => "worker-service-token"
  }.freeze

  around do |example|
    original = AUTH_ENV.keys.to_h { |key| [ key, ENV[key] ] }
    AUTH_ENV.each { |key, value| ENV[key] = value }

    example.run
  ensure
    original.each do |key, value|
      if value.nil?
        ENV.delete(key)
      else
        ENV[key] = value
      end
    end
  end

  describe "POST /api/session" do
    it "sets a signed HTTP-only cookie for the correct passphrase" do
      post "/api/session", params: { passphrase: "correct-passphrase" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("status" => "ok")

      cookie = response.headers["Set-Cookie"]
      expect(cookie).to include("#{Api::BaseController::AUTH_COOKIE_NAME}=")
      expect(cookie.downcase).to include("httponly")
    end

    it "persists the session cookie with a 90-day lifetime" do
      post "/api/session", params: { passphrase: "correct-passphrase" }

      cookie = response.headers["Set-Cookie"].downcase
      expect(cookie).to include("max-age=#{90.days.to_i}")
      expect(cookie).to include("expires=")
    end

    it "returns the auth error shape for the wrong passphrase" do
      post "/api/session", params: { passphrase: "wrong-passphrase" }

      expect(response).to have_http_status(:unauthorized)
      expect(JSON.parse(response.body)).to eq(
        "error" => {
          "code" => "unauthorized",
          "message" => "Unauthorized"
        }
      )
      expect(response.headers["Set-Cookie"]).to be_nil
    end
  end

  describe "session-protected endpoints" do
    it "leaves health reachable without a session" do
      get "/api/health"

      expect(response).to have_http_status(:ok)
    end

    it "rejects a protected endpoint without a session" do
      delete "/api/session"

      expect(response).to have_http_status(:unauthorized)
      expect(JSON.parse(response.body)).to eq(
        "error" => {
          "code" => "unauthorized",
          "message" => "Unauthorized"
        }
      )
    end

    it "allows a protected endpoint with a valid session" do
      post "/api/session", params: { passphrase: "correct-passphrase" }
      expect(response).to have_http_status(:ok)

      delete "/api/session"

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("status" => "ok")
    end
  end

  describe "worker bearer guard" do
    before do
      stub_const(
        "Api::WorkerAuthProbeController",
        Class.new(Api::BaseController) do
          skip_before_action :authenticate_session!
          before_action :authenticate_worker!

          def show
            render json: { status: "ok" }
          end
        end,
      )

      Rails.application.routes.draw do
        namespace :api do
          get "worker_auth_probe", to: "worker_auth_probe#show"
        end
      end
    end

    after do
      Rails.application.reload_routes!
    end

    it "accepts the configured bearer token" do
      get "/api/worker_auth_probe",
          headers: { "Authorization" => "Bearer worker-service-token" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("status" => "ok")
    end

    it "rejects a missing bearer token" do
      get "/api/worker_auth_probe"

      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects an invalid bearer token" do
      get "/api/worker_auth_probe",
          headers: { "Authorization" => "Bearer invalid-token" }

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
