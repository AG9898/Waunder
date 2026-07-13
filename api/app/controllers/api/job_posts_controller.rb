module Api
  # Manual job/link entry for owner-submitted postings.
  class JobPostsController < BaseController
    rescue_from ActiveRecord::RecordNotFound, with: :render_not_found

    DEFAULT_PAGE_SIZE = 30
    PAGE_SIZE_ENV = "JOBS_PAGE_SIZE".freeze

    # Server-side page size for the paginated job feed; env-overridable.
    def self.page_size
      raw = ENV.fetch(PAGE_SIZE_ENV, DEFAULT_PAGE_SIZE).to_s.strip
      return DEFAULT_PAGE_SIZE if raw.blank?

      size = Integer(raw, exception: false).to_i
      size.positive? ? size.clamp(1, 1_000) : DEFAULT_PAGE_SIZE
    end

    # Scored job feed for the PWA. Server-side filter/sort/paginate.
    # Read-only; never triggers scoring or the LLM.
    def index
      relation = filtered_job_posts.includes(:company)
      total = relation.count

      page_size = self.class.page_size
      page_number = requested_page
      offset = (page_number - 1) * page_size

      rows = ordered(relation).limit(page_size).offset(offset)

      render json: {
        job_posts: rows.map { |job_post| serialize_summary(job_post) },
        page: {
          number: page_number,
          size: page_size,
          total: total,
          has_next: offset + rows.length < total
        }
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

    # PATCH /api/job_posts/:id/lifecycle
    # Transition a single JobPost between active/backlog/removed. "removed" is a
    # soft-delete: the row remains restorable for the configured retention
    # window, then the maintenance sweep may purge it when no Application exists.
    def lifecycle
      target = lifecycle_target
      return render_invalid_lifecycle unless target

      job_post = ::JobPost.includes(:company).find(params[:id])
      apply_lifecycle!(job_post, target)

      render json: { job_post: serialize_summary(job_post.reload) }
    end

    # PATCH /api/job_posts/lifecycle
    # Apply one lifecycle_state to many ids in a single transaction.
    def bulk_lifecycle
      target = lifecycle_target
      return render_invalid_lifecycle unless target

      ids = Array(params[:ids]).map(&:to_i).reject(&:zero?).uniq
      return render_invalid_lifecycle("ids must be a non-empty list") if ids.empty?

      job_posts = ::JobPost.includes(:company).where(id: ids).to_a
      missing = ids - job_posts.map(&:id)
      return render_not_found if missing.any?

      ::JobPost.transaction do
        job_posts.each { |job_post| apply_lifecycle!(job_post, target) }
      end

      render json: {
        job_posts: job_posts.map { |job_post| serialize_summary(job_post.reload) }
      }
    end

    private

    def lifecycle_target
      source = params[:job_post].presence || params
      value = source[:lifecycle_state].to_s
      JobPost::LIFECYCLE_STATES.include?(value) ? value : nil
    end

    # Update the lifecycle_state and record an audit event of the change.
    def apply_lifecycle!(job_post, target)
      previous = job_post.lifecycle_state
      return if previous == target

      job_post.update!(
        lifecycle_state: target,
        expires_at: target == "removed" ? JobPost.removed_retention_days.days.from_now : nil
      )
      job_post.audit_events.create!(
        event_type: "lifecycle_changed",
        metadata: {
          "from" => previous,
          "to" => target,
          "purge_after" => job_post.expires_at&.iso8601
        }.compact
      )
    end

    def filtered_job_posts
      relation = status_scoped(JobPost.all)
      relation = state_scoped(relation)
      relation = score_band_scoped(relation)
      relation = source_scoped(relation)
      relation = location_scoped(relation)
      date_scoped(relation)
    end

    def status_scoped(relation)
      case params[:status].to_s
      when "unscored"
        relation.where.not(scoring_status: JobScorer::STATUS_SCORED)
      else
        relation.where(scoring_status: JobScorer::STATUS_SCORED)
      end
    end

    def state_scoped(relation)
      case params[:state].to_s
      when "backlog"
        relation.backlog
      when "removed"
        relation.removed
      else
        relation.active
      end
    end

    def score_band_scoped(relation)
      case params[:score_band].to_s
      when "high"
        relation.where(match_score: 75..)
      when "mid"
        relation.where(match_score: 50..74)
      when "low"
        relation.where(match_score: ..49)
      when "unscored"
        relation.where(match_score: nil)
      else
        relation
      end
    end

    def source_scoped(relation)
      source = params[:source].to_s.strip
      return relation if source.blank?

      relation.where(source: source)
    end

    def location_scoped(relation)
      location = params[:location].to_s.strip
      return relation if location.blank?

      relation.where("location ILIKE ?", "%#{location}%")
    end

    def date_scoped(relation)
      relation = relation.where(created_at: parse_date(params[:date_from]).beginning_of_day..) if parsed_date?(params[:date_from])
      relation = relation.where(created_at: ..parse_date(params[:date_to]).end_of_day) if parsed_date?(params[:date_to])
      relation
    end

    def ordered(relation)
      case params[:sort].to_s
      when "score"
        relation.order(
          Arel.sql("match_score DESC NULLS LAST"),
          Arel.sql("triage_score DESC NULLS LAST"),
          created_at: :desc
        )
      else
        relation.order(created_at: :asc)
      end
    end

    def requested_page
      page = params[:page].to_i
      page.positive? ? page : 1
    end

    def parsed_date?(value)
      !parse_date(value).nil?
    end

    def parse_date(value)
      Date.parse(value.to_s)
    rescue ArgumentError, TypeError
      nil
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
        lifecycle_state: job_post.lifecycle_state,
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
        lifecycle_state: job_post.lifecycle_state,
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

    def render_invalid_lifecycle(message = "lifecycle_state must be one of: #{JobPost::LIFECYCLE_STATES.join(', ')}")
      render json: {
        error: { code: "invalid_input", message: message }
      }, status: :unprocessable_content
    end
  end
end
