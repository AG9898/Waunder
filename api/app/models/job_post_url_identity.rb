class JobPostUrlIdentity < ApplicationRecord
  ROLES = %w[source posting application].freeze

  belongs_to :job_post

  validates :original_url, :identity_key, :role, presence: true
  validates :role, inclusion: { in: ROLES }
  validates :original_url, uniqueness: { scope: [ :job_post_id, :role ] }
end
