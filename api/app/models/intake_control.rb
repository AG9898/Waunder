class IntakeControl < ApplicationRecord
  MAINTENANCE_INTERVAL = 1.day

  def self.current
    find_or_create_by!(id: 1)
  rescue ActiveRecord::RecordNotUnique
    retry
  end

  def pause!
    update!(enabled: false, paused_at: Time.current)
  end

  def resume!
    update!(enabled: true, resumed_at: Time.current)
  end

  def schedule_maintenance_if_due!
    due = with_lock do
      next false if last_maintenance_at.present? && last_maintenance_at > MAINTENANCE_INTERVAL.ago

      update!(last_maintenance_at: Time.current)
      true
    end

    ExpireStaleJobPostsJob.perform_later if due
    due
  end
end
