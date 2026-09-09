module Api
  # Owner-controlled, manual-use cover-letter drafts for a JobPost. These
  # endpoints never create an Application or dispatch a worker submit task.
  class CoverLetterDraftsController < BaseController
    rescue_from ActiveRecord::RecordNotFound, with: :render_not_found

    def show
      job_post = JobPost.includes(:cover_letter_draft).find(params[:job_post_id])
      render json: { cover_letter_draft: serialize(job_post.cover_letter_draft) }
    end

    def create
      job_post = JobPost.includes(:company, :cover_letter_draft).find(params[:job_post_id])
      result = CoverLetterGenerator.new(job_post).call

      case result.status
      when CoverLetterGenerator::STATUS_GENERATED
        render json: { cover_letter_draft: serialize(result.cover_letter_draft) }, status: :created
      when CoverLetterGenerator::STATUS_SKIPPED
        render json: {
          error: { code: "llm_unavailable", message: "Cover-letter generation is not configured" }
        }, status: :service_unavailable
      else
        render json: {
          error: { code: "generation_failed", message: "Cover-letter generation failed" }
        }, status: :bad_gateway
      end
    end

    private

    def serialize(draft)
      return nil if draft.nil?

      {
        id: draft.id,
        job_post_id: draft.job_post_id,
        body: draft.body,
        generated_at: draft.generated_at
      }
    end

    def render_not_found
      render json: {
        error: { code: "not_found", message: "JobPost not found" }
      }, status: :not_found
    end
  end
end
