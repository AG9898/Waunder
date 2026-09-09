# Background job that reads a job posting URL and backfills the JobPost fields
# manual entry left blank, then scores it.
#
# Delegates all logic to JobPostEnricher (app/services/job_post_enricher.rb).
# Scoring is enqueued afterwards — and regardless of whether enrichment found
# anything — so the scorer sees the real title and description instead of a
# host-derived placeholder with an empty body.
class EnrichJobPostJob < ApplicationJob
  queue_as :default

  def perform(job_post)
    result = JobPostEnricher.new(job_post).call

    Rails.logger.info(
      "EnrichJobPostJob complete job_post_id=#{job_post.id} status=#{result.status} " \
      "fields=#{result.updated_fields.join(",")}"
    )

    ScoreJobPostJob.perform_later(job_post.reload)
  end
end
