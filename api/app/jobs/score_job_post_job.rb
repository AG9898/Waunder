# Background job that scores a normalized JobPost via the LLM gateway.
#
# Delegates all logic to JobScorer (app/services/job_scorer.rb), which writes the
# structured scoring fields onto the JobPost. The job stays thin: it loads the
# record, runs the scorer, and logs only non-PII metadata. When no API key is
# configured the scorer marks the post `skipped` and the job completes without
# raising.
class ScoreJobPostJob < ApplicationJob
  queue_as :default

  def perform(job_post)
    result = JobScorer.new(job_post).call

    Rails.logger.info(
      "ScoreJobPostJob complete job_post_id=#{job_post.id} status=#{result.status}"
    )
  end
end
