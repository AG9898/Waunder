class CreateJobPostAuditEvents < ActiveRecord::Migration[8.1]
  def change
    create_table :job_post_audit_events do |t|
      t.references :job_post, null: false, foreign_key: true
      t.string :event_type, null: false, default: "lifecycle_changed"
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end

    add_index :job_post_audit_events, :event_type
    add_check_constraint :job_post_audit_events,
      "jsonb_typeof(metadata) = 'object'",
      name: "job_post_audit_events_metadata_json_object"
  end
end
