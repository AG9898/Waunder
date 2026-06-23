class AddTriageToJobPosts < ActiveRecord::Migration[8.1]
  def change
    add_column :job_posts, :triage_status, :string, null: false, default: "unreviewed"
    add_column :job_posts, :triage_score, :integer
    add_column :job_posts, :triage_reasons, :jsonb, null: false, default: []
    add_column :job_posts, :triaged_at, :datetime

    add_index :job_posts, :triage_status
    add_check_constraint :job_posts,
      "triage_score IS NULL OR (triage_score >= 0 AND triage_score <= 100)",
      name: "job_posts_triage_score_range"
  end
end
