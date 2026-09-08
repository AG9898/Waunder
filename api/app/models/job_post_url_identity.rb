class JobPostUrlIdentity < ApplicationRecord
  ROLES = %w[source posting application].freeze

  belongs_to :job_post

  validates :original_url, :identity_key, :role, presence: true
  validates :role, inclusion: { in: ROLES }
  validates :original_url, uniqueness: { scope: [ :job_post_id, :role ] }
  validate :identity_key_has_one_owner

  private

  def identity_key_has_one_owner
    return if identity_key.blank? || job_post_id.blank?
    return unless self.class.where(identity_key:).where.not(job_post_id:).exists?

    errors.add(:identity_key, "is already owned by another job post")
  end
end
