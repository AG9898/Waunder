module Api
  class SessionsController < BaseController
    skip_before_action :authenticate_session!, only: :create

    def create
      unless shared_secret_matches?(params[:passphrase])
        render_auth_error
        return
      end

      create_session_cookie!
      render json: { status: "ok" }
    end

    def destroy
      clear_session_cookie!
      render json: { status: "ok" }
    end
  end
end
