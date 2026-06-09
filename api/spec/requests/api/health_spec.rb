require "rails_helper"

RSpec.describe "Api::Health", type: :request do
  describe "GET /api/health" do
    it "returns ok status with database connectivity" do
      get "/api/health"

      expect(response).to have_http_status(:ok)

      body = JSON.parse(response.body)
      expect(body["status"]).to eq("ok")
      expect(body["service"]).to eq("waunder-api")
      expect(body["database"]).to eq("connected")
    end
  end
end
