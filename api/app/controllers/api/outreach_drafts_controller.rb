module Api
  # Generate OutreachDrafts for a ContactCandidate from a loose template via the
  # OpenRouter LLM. Drafts are prefilled for MANUAL sending only — this endpoint
  # never sends a message anywhere. Session-guarded (single-user owner session).
  class OutreachDraftsController < BaseController
    rescue_from ActiveRecord::RecordNotFound, with: :render_not_found

    def create
      candidate = ContactCandidate.find(params[:contact_candidate_id])
      result = OutreachDraftGenerator.new(
        candidate,
        loose_template: outreach_params[:loose_template]
      ).call

      case result.status
      when OutreachDraftGenerator::STATUS_GENERATED
        render json: { outreach_draft: serialize(result.outreach_draft) }, status: :created
      when OutreachDraftGenerator::STATUS_SKIPPED
        render json: {
          error: { code: "llm_unavailable", message: "Outreach generation is not configured" }
        }, status: :service_unavailable
      else
        render json: {
          error: { code: "generation_failed", message: "Outreach generation failed" }
        }, status: :bad_gateway
      end
    end

    private

    def outreach_params
      source = params[:outreach_draft].presence || params
      source.permit(:loose_template)
    end

    def render_not_found
      render json: {
        error: { code: "not_found", message: "ContactCandidate not found" }
      }, status: :not_found
    end

    def serialize(draft)
      {
        id: draft.id,
        contact_candidate_id: draft.contact_candidate_id,
        message: draft.message,
        loose_template: draft.loose_template,
        created_at: draft.created_at
      }
    end
  end
end
