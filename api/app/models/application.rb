class Application < ApplicationRecord
  STATUSES = %w[
    draft
    approved
    submitted
    paused
    failed
  ].freeze

  PIPELINE_STATUSES = %w[
    interested
    drafting
    applied
    interviewing
    offer
    rejected
    withdrawn
    archived
    needs_review
  ].freeze

  DEFAULT_PIPELINE_STAGE_BY_STATUS = {
    "applied" => "waiting"
  }.freeze

  belongs_to :job_post
  has_one :application_draft, dependent: :destroy
  has_many :audit_events, dependent: :destroy

  validates :status, presence: true, inclusion: { in: STATUSES }
  validates :pipeline_status, presence: true, inclusion: { in: PIPELINE_STATUSES }
  validates :pipeline_stage, length: { maximum: 80 }, format: { with: /\A[a-z0-9_]+\z/, allow_blank: true }

  before_validation :normalize_pipeline_fields

  def apply_pipeline_status!(status:, stage: nil, note: nil, next_follow_up_on: nil)
    assign_pipeline_status(status: status, stage: stage, note: note, next_follow_up_on: next_follow_up_on)
    save!
  end

  def assign_pipeline_status(status:, stage: nil, note: nil, next_follow_up_on: nil)
    self.pipeline_status = status
    self.pipeline_stage = stage.presence || DEFAULT_PIPELINE_STAGE_BY_STATUS[status.to_s]
    self.pipeline_note = note unless note.nil?
    self.next_follow_up_on = next_follow_up_on unless next_follow_up_on.nil?
    self.last_status_change_at = Time.current
  end

  private

  def normalize_pipeline_fields
    self.pipeline_status = pipeline_status.to_s.strip.downcase
    self.pipeline_stage = pipeline_stage.to_s.strip.downcase.presence
  end
end
