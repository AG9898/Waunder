class InboundEmail < ApplicationRecord
  validates :provider, :event_id, :event_type, presence: true
  validate :raw_payload_must_be_object

  private

  def raw_payload_must_be_object
    return if raw_payload.is_a?(Hash)

    errors.add(:raw_payload, "must be an object")
  end
end
