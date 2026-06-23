class JobPostAuditEvent < ApplicationRecord
  belongs_to :job_post

  validates :event_type, presence: true
  validate :metadata_must_be_object

  private

  def metadata_must_be_object
    return if metadata.is_a?(Hash)

    errors.add(:metadata, "must be an object")
  end
end
