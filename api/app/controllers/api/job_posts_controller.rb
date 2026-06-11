module Api
  # Manual job/link entry for owner-submitted postings.
  class JobPostsController < BaseController
    def create
      result = ManualJobPostImporter.new(job_post_params).call

      unless result.ok?
        return render json: {
          error: {
            code: "invalid_input",
            message: result.errors.join(", ")
          }
        }, status: :unprocessable_content
      end

      job_post = result.job_post
      resolution = ApplicationRouteResolver.new(job_post).call
      ScoreJobPostJob.perform_later(job_post)

      render json: {
        job_post: {
          id: job_post.id,
          title: job_post.title,
          company: job_post.company.name,
          posting_url: job_post.posting_url,
          source: job_post.source,
          scoring_status: job_post.scoring_status,
          route: {
            route_type: resolution.route_type,
            recommended_route: resolution.recommended_route,
            application_url: resolution.application_url
          }
        }
      }, status: :created
    end

    private

    def job_post_params
      source = params[:job_post].presence || params
      source.permit(:url, :posting_url, :text, :pasted_text, :description, :title, :company)
    end
  end
end
