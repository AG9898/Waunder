# Enqueues the approved worker task payload for trusted submit execution.
#
# The task-pull/report API is added separately; for now this job is the durable
# handoff point that proves Rails passed its submit gate and queued exactly the
# structured payload the worker will later consume.
class WorkerDispatchJob < ApplicationJob
  queue_as :default

  def perform(application, payload)
    Rails.logger.info(
      "WorkerDispatchJob ready application_id=#{application.id} ats=#{payload.fetch("ats", nil)}"
    )
  end
end
