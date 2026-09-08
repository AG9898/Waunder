class CreateJobPostUrlIdentities < ActiveRecord::Migration[8.1]
  ROLES = %w[source posting application].freeze

  def change
    create_table :job_post_url_identities do |t|
      t.references :job_post, null: false, foreign_key: true
      t.text :original_url, null: false
      t.text :identity_key, null: false
      t.string :role, null: false

      t.timestamps
    end

    quoted_roles = ROLES.map { |role| quote(role) }.join(", ")
    add_check_constraint :job_post_url_identities, "role IN (#{quoted_roles})",
      name: "job_post_url_identities_role_check"
    add_index :job_post_url_identities, :identity_key
    add_index :job_post_url_identities, [ :job_post_id, :role, :original_url ], unique: true,
      name: "index_job_post_url_identities_on_alias"
  end
end
