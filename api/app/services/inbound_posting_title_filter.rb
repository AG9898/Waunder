# Applies the canonical title policy to normalized bulk-inbound posting hashes
# before JobPostMaterializer is called. The summary is stored on the source
# InboundEmail so screened-out candidates remain auditable without becoming
# domain records.
class InboundPostingTitleFilter
  Result = Struct.new(:accepted_postings, :summary, keyword_init: true)

  def self.call(postings)
    new(postings).call
  end

  def initialize(postings)
    @postings = Array(postings)
  end

  def call
    accepted = []
    rejection_reasons = Hash.new(0)

    postings.each do |posting|
      screen = JobPostTitleScreen.call(posting[:title] || posting["title"])
      if screen.accepted?
        accepted << posting
      else
        rejection_reasons[screen.reason] += 1
      end
    end

    Result.new(
      accepted_postings: accepted,
      summary: {
        "policy" => JobPostTitleScreen::POLICY_VERSION,
        "candidates" => postings.size,
        "accepted" => accepted.size,
        "rejected" => postings.size - accepted.size,
        "reasons" => rejection_reasons.sort.to_h
      }
    )
  end

  private

  attr_reader :postings
end
