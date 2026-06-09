module Api
  # Lightweight JSON health check for the API service. Reports app liveness
  # and database connectivity. Distinct from Rails' "/up" boot check.
  class HealthController < BaseController
    def show
      render json: {
        status: "ok",
        service: "waunder-api",
        database: database_status,
        time: Time.current.iso8601,
      }
    end

    private

    def database_status
      ActiveRecord::Base.connection.execute("SELECT 1")
      "connected"
    rescue StandardError
      "unavailable"
    end
  end
end
