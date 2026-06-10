class ResumeDocument < ApplicationRecord
  belongs_to :profile

  # The exported resume PDF (the file a worker actually uploads to an ATS form).
  # Stored via Active Storage; the blob bytes are not the sensitive structured
  # data (which lives encrypted in parsed_structure/raw_text below), but the
  # source of truth is the portfolio export, so the file is re-pushed on sync.
  has_one_attached :file

  # The extracted resume text and parsed structure contain personal data and
  # are encrypted at rest. parsed_structure is stored as JSON in a text column
  # and encrypted on top of that serialization.
  serialize :parsed_structure, coder: JSON, type: Hash
  encrypts :raw_text
  encrypts :parsed_structure

  validates :title, presence: true

  after_initialize :default_parsed_structure

  private

  def default_parsed_structure
    self.parsed_structure ||= {} if has_attribute?(:parsed_structure)
  end
end
