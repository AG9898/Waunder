# Recurring background job that keeps the active job-post feed fresh by
# auto-backlogging stale, unactioned posts.
#
# A post is auto-backlogged when ALL of these hold:
#   - lifecycle_state is still "active" (never touch backlog/removed rows)
#   - it is older than JOB_INTAKE_STALE_AFTER_DAYS (default 120 days)
#   - the owner has not acted on it: no Application exists, and there is no
#     "lifecycle_changed" audit event (which is only written when the owner
#     moves a post via the API). Inbound auto-backlogging does not write that
#     event, so it never counts as owner action here.
#
# Each transition writes a JobPostAuditEvent so the change is auditable. The job
# is idempotent: rows already moved out of "active" are excluded on the next
# run, so it is safe to schedule daily and run repeatedly.
class ExpireStaleJobPostsJob < ApplicationJob
  queue_as :default

  DEFAULT_STALE_AFTER_DAYS = 120

  def self.stale_after_days
    Integer(ENV.fetch("JOB_INTAKE_STALE_AFTER_DAYS", DEFAULT_STALE_AFTER_DAYS))
  end

  def perform
    cutoff = self.class.stale_after_days.days.ago
    expired = 0

    stale_unactioned_posts(cutoff).find_each do |job_post|
      job_post.update!(lifecycle_state: "backlog")
      job_post.audit_events.create!(
        event_type: "lifecycle_changed",
        metadata: {
          "from" => "active",
          "to" => "backlog",
          "reason" => "stale_sweep",
          "stale_after_days" => self.class.stale_after_days
        }
      )
      expired += 1
    end

    Rails.logger.info("ExpireStaleJobPostsJob complete expired=#{expired} cutoff=#{cutoff.iso8601}")
  end

  private

  # Active posts older than the cutoff that the owner has not acted on: no
  # Application, and no owner-driven lifecycle change recorded.
  def stale_unactioned_posts(cutoff)
    JobPost
      .active
      .where(created_at: ..cutoff)
      .where.not(id: Application.select(:job_post_id))
      .where.not(id: JobPostAuditEvent.where(event_type: "lifecycle_changed").select(:job_post_id))
  end
end
