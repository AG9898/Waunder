class ApplicationRoute < ApplicationRecord
  ROUTE_TYPES = %w[
    company_careers
    greenhouse
    lever
    ashby
    workday
    linkedin_easy_apply
    indeed_apply
    glassdoor_apply
    unknown
  ].freeze

  belongs_to :job_post

  validates :route_type, presence: true, inclusion: { in: ROUTE_TYPES }
  validates :route_confidence, numericality: {
    greater_than_or_equal_to: 0,
    less_than_or_equal_to: 1
  }, allow_nil: true
end
