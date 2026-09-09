# A single, owner-requested cover letter for a JobPost. This is deliberately
# independent of Application: drafting a letter neither starts an application
# nor creates anything a worker could submit.
class CoverLetterDraft < ApplicationRecord
  belongs_to :job_post

  # A tailored letter can repeat personal resume/profile information, so keep
  # its persisted body encrypted just like the source resume fields.
  encrypts :body

  validates :body, presence: true
end
