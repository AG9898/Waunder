class CreateContactCandidatesAndOutreachDrafts < ActiveRecord::Migration[8.1]
  def change
    create_table :contact_candidates do |t|
      t.references :job_post, null: false, foreign_key: true
      t.string :name, null: false
      t.string :title
      t.string :company_name
      t.string :linkedin_url
      t.text :relevance_reason, null: false

      t.timestamps
    end

    add_index :contact_candidates, :linkedin_url

    create_table :outreach_drafts do |t|
      t.references :contact_candidate, null: false, foreign_key: true
      t.text :loose_template
      t.text :message, null: false

      t.timestamps
    end
  end
end
