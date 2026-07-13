require "rails_helper"

RSpec.describe ExpireStaleJobPostsJob, type: :job do
  def job_post(created_at:, lifecycle_state: "active", title: "Backend Engineer")
    company = Company.find_or_create_by!(name: "Acme Corp")
    JobPost.create!(
      company: company,
      title: title,
      lifecycle_state: lifecycle_state,
      created_at: created_at,
      updated_at: created_at
    )
  end

  describe "#perform" do
    it "backlogs active unactioned posts older than the stale window and audits each" do
      stale = job_post(created_at: 130.days.ago)

      expect { described_class.new.perform }
        .to change { stale.reload.lifecycle_state }.from("active").to("backlog")

      event = stale.audit_events.where(event_type: "lifecycle_changed").last
      expect(event.metadata).to include(
        "from" => "active",
        "to" => "backlog",
        "reason" => "stale_sweep",
        "stale_after_days" => 120
      )
    end

    it "leaves recent active posts untouched" do
      fresh = job_post(created_at: 10.days.ago)

      described_class.new.perform

      expect(fresh.reload.lifecycle_state).to eq("active")
      expect(fresh.audit_events).to be_empty
    end

    it "never backlogs backlog or removed rows" do
      backlogged = job_post(created_at: 200.days.ago, lifecycle_state: "backlog")
      removed = job_post(created_at: 200.days.ago, lifecycle_state: "removed")

      described_class.new.perform

      expect(backlogged.reload.lifecycle_state).to eq("backlog")
      expect(removed.reload.lifecycle_state).to eq("removed")
      expect(removed.expires_at).to be_within(2.seconds).of(30.days.from_now)
    end

    it "purges an explicitly removed post after its retention deadline" do
      removed = job_post(created_at: 40.days.ago, lifecycle_state: "removed")
      removed.update!(expires_at: 1.minute.ago)

      expect { described_class.new.perform }.to change(JobPost, :count).by(-1)
      expect { removed.reload }.to raise_error(ActiveRecord::RecordNotFound)
    end

    it "never purges a removed post that has an Application" do
      removed = job_post(created_at: 40.days.ago, lifecycle_state: "removed")
      removed.update!(expires_at: 1.minute.ago)
      Application.create!(job_post: removed)

      described_class.new.perform

      expect(removed.reload.lifecycle_state).to eq("removed")
    end

    it "ignores posts the owner has acted on via an Application" do
      actioned = job_post(created_at: 200.days.ago)
      Application.create!(job_post: actioned)

      described_class.new.perform

      expect(actioned.reload.lifecycle_state).to eq("active")
    end

    it "ignores posts the owner moved via a lifecycle_changed audit event" do
      moved_back = job_post(created_at: 200.days.ago)
      moved_back.audit_events.create!(
        event_type: "lifecycle_changed",
        metadata: { "from" => "backlog", "to" => "active" }
      )

      described_class.new.perform

      expect(moved_back.reload.lifecycle_state).to eq("active")
    end

    it "is idempotent across repeated runs" do
      stale = job_post(created_at: 130.days.ago)

      described_class.new.perform
      described_class.new.perform

      expect(stale.reload.lifecycle_state).to eq("backlog")
      expect(stale.audit_events.where(event_type: "lifecycle_changed").count).to eq(1)
    end

    it "honors a JOB_INTAKE_STALE_AFTER_DAYS override" do
      borderline = job_post(created_at: 40.days.ago)

      ENV["JOB_INTAKE_STALE_AFTER_DAYS"] = "30"
      begin
        described_class.new.perform
      ensure
        ENV.delete("JOB_INTAKE_STALE_AFTER_DAYS")
      end

      expect(borderline.reload.lifecycle_state).to eq("backlog")
    end
  end
end
