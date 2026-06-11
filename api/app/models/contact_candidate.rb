class ContactCandidate < ApplicationRecord
  belongs_to :job_post
  has_many :outreach_drafts, dependent: :destroy

  validates :name, presence: true
  validates :relevance_reason, presence: true
end
