class CreateCoverLetterDrafts < ActiveRecord::Migration[8.1]
  def change
    create_table :cover_letter_drafts do |t|
      t.references :job_post, null: false, foreign_key: true, index: { unique: true }
      t.text :body, null: false
      t.datetime :generated_at, null: false

      t.timestamps
    end
  end
end
