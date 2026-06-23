module Api
  # Manual job/link entry for owner-submitted postings.
  class JobPostsController < BaseController
    rescue_from ActiveRecord::RecordNotFound, with: :render_not_found

    # Scored job feed for the PWA. Read-only; never triggers scoring or the LLM.
    def index
      job_posts = scoped_job_posts.includes(:company).order(
        Arel.sql("match_score DESC NULLS LAST"), Arel.sql("triage_score DESC NULLS LAST"), created_at: :desc
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

    def score
      job_post = JobPost.includes(:company).find(params[:id])
      enqueue_manual_score(job_post)

      render json: { job_post: serialize_summary(job_post.reload) }, status: :accepted
    end

    def application_status
      job_post = JobPost.includes(:company).find(params[:id])
      application = tracked_application_for(job_post)
      return unless update_pipeline_status(application)

      render json: { application: serialize_application(application.reload) }
    end

    private

    def scoped_job_posts
      case params[:status].to_s
      when "unscored"
        JobPost.where.not(scoring_status: JobScorer::STATUS_SCORED)
      else
        JobPost.where(scoring_status: JobScorer::STATUS_SCORED)
      end
    end

    def enqueue_manual_score(job_post)
      return if job_post.scoring_status == JobScorer::STATUS_SCORED
      return if job_post.scoring_status == JobPostTriage::SCORE_STATUS_PENDING

      reasons = Array(job_post.triage_reasons)
      job_post.update!(
        scoring_status: JobPostTriage::SCORE_STATUS_PENDING,
        triage_status: JobPostTriage::STATUS_MANUAL_OVERRIDE,
        triage_reasons: (reasons + [ "manual_score_requested" ]).uniq,
        triaged_at: Time.current
      )
      ScoreJobPostJob.perform_later(job_post)
    end

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
        source: job_post.source,
        match_score: job_post.match_score,
        scoring_status: job_post.scoring_status,
        triage_status: job_post.triage_status,
        triage_score: job_post.triage_score,
        triage_reasons: job_post.triage_reasons,
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
        source: job_post.source,
        posting_url: job_post.posting_url,
        compensation: job_post.compensation,
        match_score: job_post.match_score,
        scoring_status: job_post.scoring_status,
        triage_status: job_post.triage_status,
        triage_score: job_post.triage_score,
        triage_reasons: job_post.triage_reasons,
        summary: job_post.summary,
        relevant_requirements: job_post.relevant_requirements,
        missing_requirements: job_post.missing_requirements,
        red_flags: job_post.red_flags,
        resume_alignment_notes: job_post.resume_alignment_notes,
        application_strategy: job_post.application_strategy,
        application: serialize_application(job_post.applications.order(created_at: :desc).first),
        route: {
          route_type: route&.route_type,
          recommended_route: route&.recommended_route,
          application_url: route&.application_url
        }
      }
    end

    def tracked_application_for(job_post)
      job_post.applications.order(created_at: :desc).first ||
        job_post.applications.create!(status: "draft")
    end

    def update_pipeline_status(application)
      status_params = pipeline_status_params
      application.assign_pipeline_status(
        status: status_params.fetch(:pipeline_status),
        stage: status_params[:pipeline_stage],
        note: status_params[:pipeline_note],
        next_follow_up_on: status_params[:next_follow_up_on]
      )

      unless application.save
        render_invalid_status(application.errors.full_messages.to_sentence)
        return false
      end

      application.audit_events.create!(
        event_type: "pipeline_status_changed",
        status: application.status,
        metadata: {
          "pipeline_status" => application.pipeline_status,
          "pipeline_stage" => application.pipeline_stage,
          "next_follow_up_on" => application.next_follow_up_on
        }.compact
      )
      true
    end

    def pipeline_status_params
      source = params[:application].presence || params
      permitted = source.permit(:pipeline_status, :pipeline_stage, :pipeline_note, :next_follow_up_on)
      permitted[:pipeline_status] = permitted[:pipeline_status].to_s
      permitted
    end

    def serialize_application(application)
      return nil if application.nil?

      {
        application_id: application.id,
        job_post_id: application.job_post_id,
        status: application.status,
        automation_status: application.status,
        pipeline_status: application.pipeline_status,
        pipeline_stage: application.pipeline_stage,
        pipeline_note: application.pipeline_note,
        last_status_change_at: application.last_status_change_at,
        next_follow_up_on: application.next_follow_up_on,
        submitted_at: application.submitted_at,
        failure_reason: application.failure_reason
      }
    end

    def render_not_found
      render json: {
        error: { code: "not_found", message: "JobPost not found" }
      }, status: :not_found
    end

    def render_invalid_status(message)
      render json: {
        error: { code: "invalid_status", message: message }
      }, status: :unprocessable_content
    end
  end
end
