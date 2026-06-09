class Application < ApplicationRecord
  STATUSES = %w[
    draft
    approved
    submitted
    paused
    failed
  ].freeze

  belongs_to :job_post
  has_one :application_draft, dependent: :destroy
  has_many :audit_events, dependent: :destroy

  validates :status, presence: true, inclusion: { in: STATUSES }
end
