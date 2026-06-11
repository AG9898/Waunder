module Api
  # Application actions for the single-user API.
  class ApplicationsController < BaseController
    def submit
      application = ::Application.find(params[:id] || params[:application_id])
      result = ApplicationSubmitDispatcher.new(application).call

      if result.ok?
        render json: {
          status: "dispatched",
          application_id: application.id,
          ats: result.payload["ats"]
        }
      else
        render json: {
          error: {
            code: result.code,
            message: result.message
          }
        }, status: :unprocessable_content
      end
    end
  end
end
