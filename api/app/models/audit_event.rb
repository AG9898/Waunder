class AuditEvent < ApplicationRecord
  belongs_to :application

  validates :status, presence: true, inclusion: { in: Application::STATUSES }
  validates :event_type, presence: true
  validate :screenshots_must_be_array
  validate :logs_must_be_array
  validate :metadata_must_be_object

  private

  def screenshots_must_be_array
    return if screenshots.is_a?(Array)

    errors.add(:screenshots, "must be an array")
  end

  def logs_must_be_array
    return if logs.is_a?(Array)

    errors.add(:logs, "must be an array")
  end

  def metadata_must_be_object
    return if metadata.is_a?(Hash)

    errors.add(:metadata, "must be an object")
  end
end
