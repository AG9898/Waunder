class AddPipelineTrackingToApplications < ActiveRecord::Migration[8.1]
  def change
    add_column :applications, :pipeline_status, :string, null: false, default: "interested"
    add_column :applications, :pipeline_stage, :string
    add_column :applications, :pipeline_note, :text
    add_column :applications, :last_status_change_at, :datetime
    add_column :applications, :next_follow_up_on, :date

    add_index :applications, :pipeline_status
    add_index :applications, :last_status_change_at

    add_check_constraint :applications,
                         "pipeline_status IN ('interested', 'drafting', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn', 'archived', 'needs_review')",
                         name: "applications_pipeline_status_check"
  end
end
