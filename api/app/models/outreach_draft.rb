class OutreachDraft < ApplicationRecord
  belongs_to :contact_candidate

  validates :message, presence: true
end
