class Company < ApplicationRecord
  has_many :job_posts, dependent: :restrict_with_error

  validates :name, presence: true
end
