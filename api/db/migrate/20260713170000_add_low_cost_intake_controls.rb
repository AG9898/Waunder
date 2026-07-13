class AddLowCostIntakeControls < ActiveRecord::Migration[8.1]
  def change
    create_table :intake_controls do |t|
      t.boolean :enabled, null: false, default: true
      t.datetime :paused_at
      t.datetime :resumed_at
      t.datetime :last_maintenance_at

      t.timestamps
    end

    add_column :inbound_emails, :intake_state, :string, null: false, default: "queued"
    add_index :inbound_emails, :intake_state
    add_check_constraint :inbound_emails,
      "intake_state IN ('queued', 'held', 'processing', 'processed', 'failed')",
      name: "inbound_emails_intake_state_values"
  end
end
