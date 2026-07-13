# Maintenance job that keeps the job-post store bounded by auto-backlogging
# stale, unactioned posts and purging explicitly removed posts after retention.
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

    scheduled_for_purge = schedule_untracked_removed_posts!
    purged = purge_expired_removed_posts!

    Rails.logger.info(
      "ExpireStaleJobPostsJob complete expired=#{expired} " \
        "scheduled_for_purge=#{scheduled_for_purge} purged=#{purged} cutoff=#{cutoff.iso8601}"
    )
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

  # Existing removed rows predate the retention policy and have no expires_at.
  # Give them a full retention window from the first low-cost maintenance run.
  def schedule_untracked_removed_posts!
    JobPost
      .removed
      .where(expires_at: nil)
      .where.not(id: Application.select(:job_post_id))
      .update_all(
        expires_at: JobPost.removed_retention_days.days.from_now,
        updated_at: Time.current
      )
  end

  def purge_expired_removed_posts!
    count = 0
    JobPost
      .removed
      .where(expires_at: ..Time.current)
      .where.not(id: Application.select(:job_post_id))
      .find_each do |job_post|
        job_post.destroy!
        count += 1
      end
    count
  end
end
