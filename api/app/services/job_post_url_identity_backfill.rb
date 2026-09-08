class JobPostUrlIdentityBackfill
  COLLISION_EVENT_TYPE = "url_identity_collision_resolved"
  Candidate = Struct.new(:job_post_id, :role, :original_url, :identity_key, keyword_init: true)

  def self.call
    new.call
  end

  def call
    JobPost.transaction do
      candidates.group_by(&:identity_key).each do |identity_key, group|
        backfill_identity(identity_key, group)
      end
    end
  end

  private

  def candidates
    field_candidates + existing_identity_candidates
  end

  def field_candidates
    JobPost.includes(:application_route).order(:id).find_each.with_object([]) do |job_post, candidates|
      url_values(job_post).each do |role, url|
        append_candidate(candidates, job_post.id, role, url)
      end
    end
  end

  def url_values(job_post)
    route = job_post.application_route

    [
      [ "source", job_post.source_url ],
      [ "posting", job_post.posting_url ],
      [ "source", route&.source_url ],
      [ "posting", route&.canonical_posting_url ],
      [ "application", route&.application_url ]
    ]
  end

  def append_candidate(candidates, job_post_id, role, original_url)
    return if original_url.blank?

    identity_key = JobUrlIdentity.key(original_url)
    return unless identity_key

    candidates << Candidate.new(job_post_id:, role:, original_url:, identity_key:)
  end

  def existing_identity_candidates
    JobPostUrlIdentity.find_each.with_object([]) do |identity, candidates|
      candidates << Candidate.new(
        job_post_id: identity.job_post_id,
        role: identity.role,
        original_url: identity.original_url,
        identity_key: JobUrlIdentity.key(identity.original_url) || identity.identity_key
      )
    end
  end

  def backfill_identity(identity_key, group)
    owner_id = group.map(&:job_post_id).min
    resolve_collisions(identity_key, group, owner_id)

    group.select { |candidate| candidate.job_post_id == owner_id }
      .uniq { |candidate| [ candidate.role, candidate.original_url ] }
      .each { |candidate| ensure_alias(candidate) }
  end

  def resolve_collisions(identity_key, group, owner_id)
    group.map(&:job_post_id).uniq.reject { |job_post_id| job_post_id == owner_id }.each do |job_post_id|
      aliases = aliases_for(group, job_post_id)
      record_collision(job_post_id, identity_key, owner_id, aliases)
      aliases.each do |alias_record|
        JobPostUrlIdentity.where(
          job_post_id:,
          role: alias_record.fetch("role"),
          original_url: alias_record.fetch("original_url")
        ).delete_all
      end
    end
  end

  def aliases_for(group, job_post_id)
    group.select { |candidate| candidate.job_post_id == job_post_id }
      .map { |candidate| { "role" => candidate.role, "original_url" => candidate.original_url } }
      .uniq
      .sort_by { |alias_record| [ alias_record.fetch("role"), alias_record.fetch("original_url") ] }
  end

  def record_collision(job_post_id, identity_key, owner_id, aliases)
    key = [ job_post_id, identity_key ]
    return if collision_events[key]

    JobPostAuditEvent.create!(
      job_post_id:,
      event_type: COLLISION_EVENT_TYPE,
      metadata: {
        "identity_key" => identity_key,
        "canonical_job_post_id" => owner_id,
        "discarded_aliases" => aliases
      }
    )
    collision_events[key] = true
  end

  def collision_events
    @collision_events ||= JobPostAuditEvent.where(event_type: COLLISION_EVENT_TYPE).each_with_object({}) do |event, events|
      events[[ event.job_post_id, event.metadata["identity_key"] ]] = true
    end
  end

  def ensure_alias(candidate)
    identity = JobPostUrlIdentity.find_or_initialize_by(
      job_post_id: candidate.job_post_id,
      role: candidate.role,
      original_url: candidate.original_url
    )
    identity.identity_key = candidate.identity_key
    identity.save! if identity.new_record? || identity.changed?
  end
end
