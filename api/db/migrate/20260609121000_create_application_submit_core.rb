class CreateApplicationSubmitCore < ActiveRecord::Migration[8.1]
  APPLICATION_STATUSES = %w[
    draft
    approved
    submitted
    paused
    failed
  ].freeze

  def change
    create_table :applications do |t|
      t.references :job_post, null: false, foreign_key: true
      t.string :status, null: false, default: "draft"
      t.datetime :approved_at
      t.datetime :submitted_at
      t.text :failure_reason

      t.timestamps
    end

    add_index :applications, :status

    quoted_statuses = APPLICATION_STATUSES.map { |status| quote(status) }.join(", ")
    add_check_constraint :applications, "status IN (#{quoted_statuses})",
      name: "applications_status_check"

    create_table :application_drafts do |t|
      t.references :application, null: false, foreign_key: true, index: { unique: true }
      t.text :resume_emphasis_notes
      t.text :cover_letter
      t.text :message
      t.jsonb :structured_answers, null: false, default: []
      t.jsonb :autofill_payload, null: false, default: {}

      t.timestamps
    end

    add_check_constraint :application_drafts,
      "jsonb_typeof(structured_answers) = 'array'",
      name: "application_drafts_structured_answers_json_array"
    add_check_constraint :application_drafts,
      "jsonb_typeof(autofill_payload) = 'object'",
      name: "application_drafts_autofill_payload_json_object"

    create_table :audit_events do |t|
      t.references :application, null: false, foreign_key: true
      t.string :status, null: false
      t.string :event_type, null: false, default: "status_change"
      t.text :reason
      t.jsonb :screenshots, null: false, default: []
      t.jsonb :logs, null: false, default: []
      t.jsonb :metadata, null: false, default: {}

      t.timestamps
    end

    add_index :audit_events, :status
    add_index :audit_events, :event_type
    add_check_constraint :audit_events, "status IN (#{quoted_statuses})",
      name: "audit_events_status_check"
    add_check_constraint :audit_events,
      "jsonb_typeof(screenshots) = 'array'",
      name: "audit_events_screenshots_json_array"
    add_check_constraint :audit_events,
      "jsonb_typeof(logs) = 'array'",
      name: "audit_events_logs_json_array"
    add_check_constraint :audit_events,
      "jsonb_typeof(metadata) = 'object'",
      name: "audit_events_metadata_json_object"
  end
end
