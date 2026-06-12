module Api
  # Save and list ContactCandidates linked to a JobPost. A ContactCandidate is a
  # person worth reaching out to about a posting, with a relevance reason. All
  # endpoints are session-guarded (single-user owner session).
  class ContactCandidatesController < BaseController
    rescue_from ActiveRecord::RecordNotFound, with: :render_not_found

    def index
      job_post = JobPost.find(params[:job_post_id])
      candidates = job_post.contact_candidates.order(created_at: :desc)

      render json: {
        contact_candidates: candidates.map { |candidate| serialize(candidate) }
      }
    end

    def create
      job_post = JobPost.find(params[:job_post_id])
      candidate = job_post.contact_candidates.build(contact_candidate_params)

      unless candidate.save
        return render json: {
          error: {
            code: "invalid_input",
            message: candidate.errors.full_messages.join(", ")
          }
        }, status: :unprocessable_content
      end

      render json: { contact_candidate: serialize(candidate) }, status: :created
    end

    private

    def contact_candidate_params
      source = params[:contact_candidate].presence || params
      source.permit(:name, :title, :company_name, :linkedin_url, :relevance_reason)
    end

    def render_not_found
      render json: {
        error: { code: "not_found", message: "JobPost not found" }
      }, status: :not_found
    end

    def serialize(candidate)
      {
        id: candidate.id,
        job_post_id: candidate.job_post_id,
        name: candidate.name,
        title: candidate.title,
        company_name: candidate.company_name,
        linkedin_url: candidate.linkedin_url,
        relevance_reason: candidate.relevance_reason,
        created_at: candidate.created_at
      }
    end
  end
end
