class CreatePushSubscriptions < ActiveRecord::Migration[8.1]
  def change
    create_table :push_subscriptions do |t|
      t.string :endpoint, null: false
      t.text :p256dh_key, null: false
      t.text :auth_key, null: false
      t.string :content_encoding, null: false, default: "aes128gcm"
      t.datetime :expires_at
      t.string :user_agent

      t.timestamps
    end

    add_index :push_subscriptions, :endpoint, unique: true
  end
end
