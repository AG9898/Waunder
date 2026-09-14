# Re-evaluates historical bulk-inbound JobPosts with the current title policy.
# Dry-run is the default. Apply mode soft-removes only untracked, owner-untouched
# failures; manual imports and records with meaningful owner activity are kept.
class OffScopeJobPostCleanup
  SAMPLE_LIMIT = 25

  Report = Struct.new(
    :dry_run,
    :policy,
    :scanned,
    :accepted,
    :would_remove,
    :removed,
    :already_removed,
    :preserved,
    :rejection_reasons,
    :samples,
    keyword_init: true
  ) do
    def to_h
      members.to_h { |member| [ member, public_send(member) ] }
    end
  end

  def initialize(dry_run: true, sample_limit: SAMPLE_LIMIT, relation: default_relation)
    @dry_run = dry_run
    @sample_limit = sample_limit
    @relation = relation
  end

  def call
    counts = Hash.new(0)
    reasons = Hash.new(0)
    samples = []

    relation.includes(:applications, :contact_candidates, :cover_letter_draft, :audit_events, :company).find_each do |job_post|
      counts[:scanned] += 1
      screen = JobPostTitleScreen.call(job_post.title)

      if screen.accepted?
        counts[:accepted] += 1
        next
      end

      reasons[screen.reason] += 1
      disposition = disposition_for(job_post)
      counts[disposition] += 1
      append_sample(samples, job_post, screen.reason, disposition)

      remove!(job_post, screen.reason) if disposition == :would_remove && !dry_run
    end

    Report.new(
      dry_run: dry_run,
      policy: JobPostTitleScreen::POLICY_VERSION,
      scanned: counts[:scanned],
      accepted: counts[:accepted],
      would_remove: dry_run ? counts[:would_remove] : 0,
      removed: dry_run ? 0 : counts[:would_remove],
      already_removed: counts[:already_removed],
      preserved: counts[:preserved],
      rejection_reasons: reasons.sort.to_h,
      samples: samples
    )
  end

  private

  attr_reader :dry_run, :sample_limit, :relation

  def default_relation
    JobPost.where("source IS NULL OR source <> ?", "manual")
  end

  def disposition_for(job_post)
    return :already_removed if job_post.lifecycle_state == "removed"
    return :preserved if owner_touched?(job_post)

    :would_remove
  end

  def owner_touched?(job_post)
    job_post.applications.any? ||
      job_post.contact_candidates.any? ||
      job_post.cover_letter_draft.present? ||
      job_post.triage_status == JobPostTriage::STATUS_MANUAL_OVERRIDE ||
      owner_audit_event?(job_post)
  end

  def owner_audit_event?(job_post)
    job_post.audit_events.any? do |event|
      event.event_type == ManualJobPostImporter::MATCH_EVENT_TYPE ||
        (event.event_type == "lifecycle_changed" && event.metadata["reason"] != "stale_sweep")
    end
  end

  def append_sample(samples, job_post, reason, disposition)
    return if samples.size >= sample_limit

    samples << {
      id: job_post.id,
      title: job_post.title,
      company: job_post.company.name,
      source: job_post.source,
      lifecycle_state: job_post.lifecycle_state,
      reason: reason,
      disposition: disposition.to_s
    }
  end

  def remove!(job_post, reason)
    JobPost.transaction do
      previous = job_post.lifecycle_state
      purge_after = JobPost.removed_retention_days.days.from_now
      job_post.update!(
        lifecycle_state: "removed",
        expires_at: purge_after,
        scoring_status: JobPostTriage::SCORE_STATUS_FILTERED,
        triage_status: JobPostTriage::STATUS_REJECTED,
        triage_reasons: (job_post.triage_reasons + [ reason, "title_screen_#{JobPostTitleScreen::POLICY_VERSION}" ]).uniq,
        triaged_at: Time.current
      )
      job_post.audit_events.create!(
        event_type: "title_screen_cleanup",
        metadata: {
          "policy" => JobPostTitleScreen::POLICY_VERSION,
          "reason" => reason,
          "from" => previous,
          "to" => "removed",
          "purge_after" => purge_after.iso8601
        }
      )
    end
  end
end
