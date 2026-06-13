module Api
  # Manual job/link entry for owner-submitted postings.
  class JobPostsController < BaseController
    rescue_from ActiveRecord::RecordNotFound, with: :render_not_found

    # Scored job feed for the PWA. Read-only; never triggers scoring or the LLM.
    def index
      job_posts = JobPost.includes(:company).order(
        Arel.sql("match_score DESC NULLS LAST"), created_at: :desc
      )

      render json: {
        job_posts: job_posts.map { |job_post| serialize_summary(job_post) }
      }
    end

    # Full scored detail for one job plus its resolved application route.
    # Read-only; never triggers scoring or the LLM.
    def show
      job_post = JobPost.includes(:company, :application_route).find(params[:id])

      render json: { job_post: serialize_detail(job_post) }
    end

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

    # Compact feed row. Only client-safe fields; no sensitive PII is stored on
    # JobPost, so the whole record is safe to surface.
    def serialize_summary(job_post)
      {
        id: job_post.id,
        title: job_post.title,
        company: job_post.company&.name,
        match_score: job_post.match_score,
        scoring_status: job_post.scoring_status,
        summary: job_post.summary
      }
    end

    # Full scored detail plus the resolved application route.
    def serialize_detail(job_post)
      route = job_post.application_route

      {
        id: job_post.id,
        title: job_post.title,
        company: job_post.company&.name,
        posting_url: job_post.posting_url,
        match_score: job_post.match_score,
        scoring_status: job_post.scoring_status,
        summary: job_post.summary,
        relevant_requirements: job_post.relevant_requirements,
        missing_requirements: job_post.missing_requirements,
        red_flags: job_post.red_flags,
        resume_alignment_notes: job_post.resume_alignment_notes,
        application_strategy: job_post.application_strategy,
        route: {
          route_type: route&.route_type,
          recommended_route: route&.recommended_route,
          application_url: route&.application_url
        }
      }
    end

    def render_not_found
      render json: {
        error: { code: "not_found", message: "JobPost not found" }
      }, status: :not_found
    end
  end
end
