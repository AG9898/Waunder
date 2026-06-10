class Profile < ApplicationRecord
  has_many :resume_documents, dependent: :destroy

  # Sensitive contact details are encrypted at rest. Email is deterministic so
  # it can still be used in equality queries; phone and address are not queryable.
  encrypts :email, deterministic: true, downcase: true
  encrypts :phone
  encrypts :street_address

  validates :full_name, presence: true
  validate :work_history_must_be_array
  validate :education_must_be_array
  validate :skills_must_be_array

  private

  def work_history_must_be_array
    errors.add(:work_history, "must be an array") unless work_history.is_a?(Array)
  end

  def education_must_be_array
    errors.add(:education, "must be an array") unless education.is_a?(Array)
  end

  def skills_must_be_array
    errors.add(:skills, "must be an array") unless skills.is_a?(Array)
  end
end
