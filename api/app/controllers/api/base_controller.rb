module Api
  # Base controller for all /api endpoints. Shared auth, error handling, and
  # serialization for the single-user API live here.
  class BaseController < ApplicationController
    AUTH_COOKIE_NAME = "waunder_session".freeze
    AUTH_COOKIE_VALUE = { "session" => "owner" }.freeze
    AUTH_COOKIE_MAX_AGE = 90.days.to_i

    before_action :authenticate_session!

    private

    def authenticate_session!
      return if valid_session_cookie?

      render_auth_error
    end

    def authenticate_worker!
      expected_token = ENV.fetch("WORKER_SERVICE_TOKEN", nil)
      token = bearer_token

      return if secure_compare?(token, expected_token)

      render_auth_error
    end

    def valid_session_cookie?
      session_verifier.verified(request.cookies[AUTH_COOKIE_NAME]) == AUTH_COOKIE_VALUE
    rescue ActiveSupport::MessageVerifier::InvalidSignature
      false
    end

    def create_session_cookie!
      response.set_cookie(
        AUTH_COOKIE_NAME,
        value: session_verifier.generate(AUTH_COOKIE_VALUE),
        httponly: true,
        same_site: :lax,
        secure: Rails.env.production?,
        max_age: AUTH_COOKIE_MAX_AGE,
        expires: AUTH_COOKIE_MAX_AGE.seconds.from_now,
      )
    end

    def clear_session_cookie!
      response.delete_cookie(AUTH_COOKIE_NAME)
    end

    def shared_secret_matches?(passphrase)
      secure_compare?(passphrase, ENV.fetch("APP_SHARED_SECRET", nil))
    end

    def render_auth_error
      render json: {
        error: {
          code: "unauthorized",
          message: "Unauthorized"
        }
      }, status: :unauthorized
    end

    def bearer_token
      authorization = request.headers["Authorization"].to_s
      scheme, token = authorization.split(/\s+/, 2)

      return unless scheme&.casecmp("Bearer")&.zero?

      token
    end

    def session_verifier
      secret = ENV.fetch("SESSION_SECRET", nil)
      raise KeyError, "SESSION_SECRET is not configured" if secret.blank?

      ActiveSupport::MessageVerifier.new(secret, digest: "SHA256")
    end

    def secure_compare?(value, expected)
      return false if value.blank? || expected.blank?

      value = value.to_s
      expected = expected.to_s
      return false unless value.bytesize == expected.bytesize

      ActiveSupport::SecurityUtils.secure_compare(value, expected)
    end
  end
end
