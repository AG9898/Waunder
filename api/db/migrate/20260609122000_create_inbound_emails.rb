class CreateInboundEmails < ActiveRecord::Migration[8.1]
  def change
    create_table :inbound_emails do |t|
      t.string :provider, null: false, default: "resend"
      t.string :event_id, null: false
      t.string :event_type, null: false
      t.string :provider_email_id
      t.jsonb :raw_payload, null: false

      t.timestamps
    end

    add_index :inbound_emails, [ :provider, :event_id ], unique: true
    add_index :inbound_emails, :event_type
    add_index :inbound_emails, :provider_email_id
    add_check_constraint :inbound_emails, "jsonb_typeof(raw_payload) = 'object'",
      name: "inbound_emails_raw_payload_json_object"
  end
end
