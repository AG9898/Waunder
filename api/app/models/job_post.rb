class JobPost < ApplicationRecord
  LIFECYCLE_STATES = %w[active backlog removed].freeze
  DEFAULT_REMOVED_RETENTION_DAYS = 30

  def self.removed_retention_days
    value = Integer(ENV.fetch("REMOVED_JOB_RETENTION_DAYS", DEFAULT_REMOVED_RETENTION_DAYS), exception: false)
    value&.positive? ? value : DEFAULT_REMOVED_RETENTION_DAYS
  end

  belongs_to :company
  has_one :application_route, dependent: :destroy
  has_many :applications, dependent: :restrict_with_error
  has_many :contact_candidates, dependent: :destroy
  has_many :audit_events, class_name: "JobPostAuditEvent", dependent: :destroy

  validates :title, presence: true
  validates :match_score, numericality: { greater_than_or_equal_to: 0, less_than_or_equal_to: 100 },
    allow_nil: true
  validates :triage_score, numericality: { greater_than_or_equal_to: 0, less_than_or_equal_to: 100 },
    allow_nil: true
  validates :lifecycle_state, inclusion: { in: LIFECYCLE_STATES }

  scope :active, -> { where(lifecycle_state: "active") }
  scope :backlog, -> { where(lifecycle_state: "backlog") }
  scope :removed, -> { where(lifecycle_state: "removed") }
end
