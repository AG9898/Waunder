class BackfillAndEnforceJobPostUrlIdentityOwnership < ActiveRecord::Migration[8.1]
  CONSTRAINT_NAME = "job_post_url_identities_one_owner"

  def up
    enable_extension "btree_gist"
    JobPostUrlIdentityBackfill.call
    add_exclusion_constraint :job_post_url_identities,
      "identity_key WITH =, job_post_id WITH <>",
      using: :gist,
      name: CONSTRAINT_NAME
  end

  def down
    remove_exclusion_constraint :job_post_url_identities, name: CONSTRAINT_NAME
  end
end
