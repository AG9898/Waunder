class ApplicationDraft < ApplicationRecord
  belongs_to :application

  validate :structured_answers_must_be_array
  validate :autofill_payload_must_be_object

  private

  def structured_answers_must_be_array
    return if structured_answers.is_a?(Array)

    errors.add(:structured_answers, "must be an array")
  end

  def autofill_payload_must_be_object
    return if autofill_payload.is_a?(Hash)

    errors.add(:autofill_payload, "must be an object")
  end
end
