module Api
  # Application actions for the single-user API.
  class ApplicationsController < BaseController
    rescue_from ActiveRecord::RecordNotFound, with: :render_not_found

    # Generated draft for an application, for the PWA draft-review screen.
    # Read-only: it never generates a draft or calls the LLM (that happens in
    # GenerateApplicationDraftJob) and never submits.
    def show
      application = ::Application.includes(:application_draft, job_post: :company)
        .find(params[:id])

      render json: { application: serialize_draft(application) }
    end

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

    private

    # Shapes an Application + its draft for the review screen. Mirrors the
    # worker-shaped autofill_payload (which already omits sensitive questions);
    # this endpoint surfaces only what the draft generator persisted.
    def serialize_draft(application)
      draft = application.application_draft
      job_post = application.job_post

      {
        application_id: application.id,
        job_title: job_post&.title,
        company: job_post&.company&.name,
        status: application.status,
        resume_emphasis_notes: draft&.resume_emphasis_notes,
        cover_letter: draft&.cover_letter,
        structured_answers: serialize_answers(draft&.structured_answers),
        autofill_payload: serialize_autofill(draft&.autofill_payload)
      }
    end

    # Normalizes a stored [{field, value}, ...] list to string keys, tolerating
    # nil and unexpected shapes.
    def serialize_answers(answers)
      Array(answers).filter_map do |answer|
        next unless answer.is_a?(Hash)

        { field: answer["field"], value: answer["value"] }
      end
    end

    # The autofill payload is worker-shaped; surface only the preview fields the
    # PWA renders (it never includes sensitive questions by construction).
    def serialize_autofill(payload)
      payload = payload.is_a?(Hash) ? payload : {}

      {
        ats: payload["ats"],
        apply_url: payload["apply_url"],
        answers: serialize_answers(payload["answers"]),
        resume_ref: payload["resume_ref"]
      }
    end

    def render_not_found
      render json: {
        error: { code: "not_found", message: "Application not found" }
      }, status: :not_found
    end
  end
end
