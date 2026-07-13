module Api
  class IntakeController < BaseController
    def show
      control = IntakeControl.current
      control.schedule_maintenance_if_due!

      render json: { intake: serialize(control) }
    end

    def update
      enabled = requested_enabled
      return render_invalid unless [ true, false ].include?(enabled)

      control = IntakeControl.current
      queued_count = enabled ? resume!(control) : pause!(control)

      render json: { intake: serialize(control.reload).merge(queued_count: queued_count) }
    end

    private

    def requested_enabled
      value = params.dig(:intake, :enabled)
      value = params[:enabled] if value.nil?
      return true if [ true, 1, "1", "true" ].include?(value)
      return false if [ false, 0, "0", "false" ].include?(value)

      nil
    end

    def pause!(control)
      control.pause!
      0
    end

    def resume!(control)
      control.resume!
      recover_interrupted!

      held_ids = InboundEmail.held.pluck(:id)
      held_ids.each { |id| ParseInboundEmailJob.perform_later(InboundEmail.find(id)) }
      held_ids.size
    end

    # The low-cost async adapter is intentionally in-memory. If Railway stops
    # the process during an intake job, make that reference resumable again.
    def recover_interrupted!
      InboundEmail
        .where(intake_state: "processing", updated_at: ..15.minutes.ago)
        .update_all(intake_state: "held", updated_at: Time.current)
    end

    def serialize(control)
      {
        enabled: control.enabled,
        paused_at: control.paused_at,
        resumed_at: control.resumed_at,
        held_count: InboundEmail.held.count,
        processing_count: InboundEmail.where(intake_state: "processing").count
      }
    end

    def render_invalid
      render json: {
        error: {
          code: "invalid_intake_state",
          message: "enabled must be true or false"
        }
      }, status: :unprocessable_content
    end
  end
end
