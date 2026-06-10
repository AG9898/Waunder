class ResumeDocument < ApplicationRecord
  belongs_to :profile

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
