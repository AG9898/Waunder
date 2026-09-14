require "rails_helper"

RSpec.describe OffScopeJobPostCleanup do
  def job_post(title:, source: "linkedin", lifecycle_state: "active")
    JobPost.create!(
      company: Company.create!(name: "#{title} Co"),
      title: title,
      source: source,
      lifecycle_state: lifecycle_state,
      scoring_status: "scored"
    )
  end

  it "reports off-scope historical posts without writing in dry-run mode" do
    off_scope = job_post(title: "Data Scientist")
    accepted = job_post(title: "AI Engineer")

    report = described_class.new(dry_run: true).call

    expect(report.scanned).to eq(2)
    expect(report.accepted).to eq(1)
    expect(report.would_remove).to eq(1)
    expect(report.removed).to eq(0)
    expect(off_scope.reload.lifecycle_state).to eq("active")
    expect(accepted.reload.lifecycle_state).to eq("active")
    expect(JobPostAuditEvent.where(event_type: "title_screen_cleanup")).to be_empty
  end

  it "soft-removes untracked failures in apply mode and records the policy" do
    off_scope = job_post(title: "Product Manager", lifecycle_state: "backlog")

    report = described_class.new(dry_run: false).call

    expect(report.removed).to eq(1)
    expect(off_scope.reload.lifecycle_state).to eq("removed")
    expect(off_scope.scoring_status).to eq("filtered")
    expect(off_scope.expires_at).to be_within(2.seconds).of(JobPost.removed_retention_days.days.from_now)
    event = off_scope.audit_events.find_by!(event_type: "title_screen_cleanup")
    expect(event.metadata).to include(
      "policy" => JobPostTitleScreen::POLICY_VERSION,
      "from" => "backlog",
      "to" => "removed"
    )
  end

  it "preserves manual imports and off-scope posts with application history" do
    manual = job_post(title: "Product Manager", source: "manual")
    tracked = job_post(title: "Data Scientist")
    Application.create!(job_post: tracked, status: "draft", pipeline_status: "interested")

    report = described_class.new(dry_run: false).call

    expect(report.scanned).to eq(1)
    expect(report.preserved).to eq(1)
    expect(manual.reload.lifecycle_state).to eq("active")
    expect(tracked.reload.lifecycle_state).to eq("active")
  end
end
