class JobPost < ApplicationRecord
  belongs_to :company
  has_one :application_route, dependent: :destroy
  has_many :applications, dependent: :restrict_with_error
  has_many :contact_candidates, dependent: :destroy

  validates :title, presence: true
  validates :match_score, numericality: { greater_than_or_equal_to: 0, less_than_or_equal_to: 100 },
    allow_nil: true
end
