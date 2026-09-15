class AddAppliedAtToApplications < ActiveRecord::Migration[8.1]
  TRACKED_PIPELINE_STATUSES = %w[applied interviewing offer].freeze

  def up
    add_column :applications, :applied_at, :datetime

    execute <<~SQL
      UPDATE applications
      SET applied_at = COALESCE(submitted_at, last_status_change_at)
      WHERE pipeline_status IN (#{TRACKED_PIPELINE_STATUSES.map { |status| quote(status) }.join(", ")})
    SQL
  end

  def down
    remove_column :applications, :applied_at
  end
end
