require "rails_helper"

RSpec.describe EnrichJobPostJob, type: :job do
  include ActiveJob::TestHelper

  around do |example|
    original_adapter = ActiveJob::Base.queue_adapter
    ActiveJob::Base.queue_adapter = :test
    example.run
  ensure
    clear_enqueued_jobs
    ActiveJob::Base.queue_adapter = original_adapter
  end

  let(:job_post) do
    JobPost.create!(
      company: Company.find_or_create_by!(name: "Linkedin"),
      title: "Linkedin",
      posting_url: "https://www.linkedin.com/jobs/view/4435267449",
      source: "manual",
      scoring_status: "pending"
    )
  end

  it "enriches the post and then enqueues scoring, so the scorer sees the real posting" do
    enricher = instance_double(
      JobPostEnricher,
      call: JobPostEnricher::Result.new(status: "updated", updated_fields: %w[title company])
    )
    allow(JobPostEnricher).to receive(:new).with(job_post).and_return(enricher)

    expect { described_class.perform_now(job_post) }
      .to have_enqueued_job(ScoreJobPostJob).with(job_post)
  end

  it "still enqueues scoring when the posting could not be read" do
    enricher = instance_double(
      JobPostEnricher,
      call: JobPostEnricher::Result.new(status: "unavailable", updated_fields: [])
    )
    allow(JobPostEnricher).to receive(:new).with(job_post).and_return(enricher)

    expect { described_class.perform_now(job_post) }.to have_enqueued_job(ScoreJobPostJob)
  end
end
