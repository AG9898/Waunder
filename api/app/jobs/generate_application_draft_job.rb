# Background job that generates an ApplicationDraft for an Application via the
# LLM gateway.
#
# Delegates all logic to ApplicationDraftGenerator
# (app/services/application_draft_generator.rb), which writes the draft's cover
# letter, message, resume-emphasis notes, structured answers, and ATS-keyed
# autofill payload. The job stays thin: it loads the record, runs the generator,
# and logs only non-PII metadata. When no API key is configured the generator
# skips gracefully and the job completes without raising.
class GenerateApplicationDraftJob < ApplicationJob
  queue_as :default

  def perform(application)
    result = ApplicationDraftGenerator.new(application).call

    Rails.logger.info(
      "GenerateApplicationDraftJob complete application_id=#{application.id} status=#{result.status}"
    )
  end
end
