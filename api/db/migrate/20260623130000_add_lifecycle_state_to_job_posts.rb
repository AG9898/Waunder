class AddLifecycleStateToJobPosts < ActiveRecord::Migration[8.1]
  def change
    add_column :job_posts, :lifecycle_state, :string, null: false, default: "active"

    add_index :job_posts, :lifecycle_state
    add_check_constraint :job_posts,
      "lifecycle_state IN ('active', 'backlog', 'removed')",
      name: "job_posts_lifecycle_state_values"
  end
end
