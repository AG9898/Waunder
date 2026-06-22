module Api
  # Worker-only endpoints for pulling approved submit tasks and reporting
  # audited outcomes. Human session cookies are intentionally ignored here.
  class WorkerTasksController < BaseController
    skip_before_action :authenticate_session!
    before_action :authenticate_worker!

    TERMINAL_STATUSES = %w[submitted paused failed].freeze

    def index
      render json: {
        tasks: dispatched_applications.map { |application| task_payload_for(application) }
      }
    end

    def report
      application = ::Application.find(params[:id])
      status = params[:status].to_s

      return render_invalid_report("status must be submitted, paused, or failed") unless TERMINAL_STATUSES.include?(status)

      application.update!(
        status: status,
        submitted_at: status == "submitted" ? Time.current : application.submitted_at,
        failure_reason: status == "submitted" ? nil : params[:reason].presence
      )
      if status == "submitted"
        application.apply_pipeline_status!(status: "applied", stage: "waiting")
      elsif %w[paused failed].include?(status)
        application.apply_pipeline_status!(status: "needs_review")
      end
      application.audit_events.create!(
        event_type: "worker_status_reported",
        status: status,
        reason: params[:reason].presence,
        screenshots: array_param(:screenshots),
        logs: array_param(:logs),
        metadata: report_metadata
      )

      render json: {
        status: "ok",
        application_id: application.id,
        application_status: application.status
      }
    end

    private

    def dispatched_applications
      ::Application
        .includes(:application_draft, :audit_events)
        .where(status: "approved")
        .where.not(approved_at: nil)
        .joins(:audit_events)
        .where(audit_events: { event_type: "submit_dispatched" })
        .distinct
    end

    def task_payload_for(application)
      payload = application.application_draft.autofill_payload.deep_stringify_keys

      {
        applicationId: application.id.to_s,
        ats: payload.fetch("ats"),
        applyUrl: payload.fetch("apply_url"),
        answers: payload.fetch("answers", []).map do |answer|
          answer = answer.deep_stringify_keys
          { field: answer.fetch("field"), value: answer.fetch("value") }
        end,
        resumeRef: payload["resume_ref"]
      }.compact
    end

    def array_param(key)
      value = params[key]
      return [] if value.blank?
      return value if value.is_a?(Array)

      [ value ]
    end

    def report_metadata
      metadata = params[:metadata]
      return metadata.to_unsafe_h.deep_stringify_keys if metadata.is_a?(ActionController::Parameters)
      return metadata.deep_stringify_keys if metadata.is_a?(Hash)

      {}
    end

    def render_invalid_report(message)
      render json: {
        error: {
          code: "invalid_report",
          message: message
        }
      }, status: :unprocessable_content
    end
  end
end
