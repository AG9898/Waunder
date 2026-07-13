class InboundEmail < ApplicationRecord
  INTAKE_STATES = %w[queued held processing processed failed].freeze

  validates :provider, :event_id, :event_type, presence: true
  validates :intake_state, inclusion: { in: INTAKE_STATES }
  validate :raw_payload_must_be_object

  scope :held, -> { where(intake_state: "held") }

  private

  def raw_payload_must_be_object
    return if raw_payload.is_a?(Hash)

    errors.add(:raw_payload, "must be an object")
  end
end
