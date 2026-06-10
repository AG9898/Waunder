class CreateProfilesAndResumeDocuments < ActiveRecord::Migration[8.1]
  def change
    create_table :profiles do |t|
      # Structured profile capture for the single user.
      t.string :full_name
      t.string :headline
      t.text :summary
      t.string :location

      # Sensitive contact details — encrypted at rest. Email is encrypted
      # deterministically so it remains queryable; the rest are non-deterministic.
      t.string :email
      t.string :phone
      t.text :street_address

      # Public-ish profile links and structured work history / skills.
      t.string :linkedin_url
      t.string :github_url
      t.string :portfolio_url
      t.jsonb :work_history, null: false, default: []
      t.jsonb :education, null: false, default: []
      t.jsonb :skills, null: false, default: []

      t.timestamps
    end

    create_table :resume_documents do |t|
      t.references :profile, null: false, foreign_key: true

      t.string :title, null: false
      t.string :content_type
      t.string :filename
      t.string :storage_key
      t.boolean :primary, null: false, default: false

      # Raw extracted resume text and parsed structure are sensitive
      # (they contain personal data) and are encrypted at rest. parsed_structure
      # is a text column (not jsonb) because it stores ciphertext; the parsed
      # JSON is serialized at the model layer.
      t.text :raw_text
      t.text :parsed_structure

      t.string :parse_status, null: false, default: "pending"
      t.datetime :parsed_at

      t.timestamps
    end

    add_check_constraint :profiles, "jsonb_typeof(work_history) = 'array'",
      name: "profiles_work_history_json_array"
    add_check_constraint :profiles, "jsonb_typeof(education) = 'array'",
      name: "profiles_education_json_array"
    add_check_constraint :profiles, "jsonb_typeof(skills) = 'array'",
      name: "profiles_skills_json_array"
  end
end
