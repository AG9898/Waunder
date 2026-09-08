# Turns one normalized posting hash into a persisted JobPost.
#
# Shared by both inbound paths — the deterministic known-sender parsers
# (InboundEmailParser) and the LLM fallback (InboundEmailLlmExtractor) — so the
# create-Company + create-JobPost + resolve-route sequence lives in exactly one
# place.
#
# Idempotent by `posting_url`: if a JobPost already exists for the posting's
# canonical URL it is returned unchanged rather than duplicated, so a job retry
# or the same posting arriving in two alerts never creates duplicate rows.
class JobPostMaterializer
  def initialize(posting)
    @posting = posting
  end

  # Returns the persisted JobPost, or nil when the posting lacks the minimum
  # required fields (title + company).
  def call
    title = @posting[:title].to_s.strip
    company_name = @posting[:company].to_s.strip
    return nil if title.empty? || company_name.empty?

    JobPost.transaction do
      existing = find_existing
      next existing if existing

      company = Company.find_or_create_by!(name: company_name)
      job_post = JobPost.create!(
        company: company,
        title: title,
        location: @posting[:location].presence,
        compensation: @posting[:compensation].presence,
        posting_url: @posting[:posting_url].presence,
        source_url: @posting[:source_url].presence,
        source: @posting[:source].presence || "inbound",
        scoring_status: "pending"
      )
      register_source_and_posting_identities!(job_post)
      # Resolve the application route deterministically right after normalization
      # so downstream scoring/draft jobs have a recommended route.
      ApplicationRouteResolver.new(job_post).call
      job_post
    end
  end

  private

  def find_existing
    url = @posting[:posting_url].presence
    existing = JobPost.find_by(posting_url: url) if url
    return existing if existing

    identity_keys = [ url, @posting[:source_url].presence ].filter_map { |candidate| JobUrlIdentity.key(candidate) }.uniq
    return nil if identity_keys.empty?

    JobPostUrlIdentity.includes(:job_post).find_by(identity_key: identity_keys)&.job_post
  end

  def register_source_and_posting_identities!(job_post)
    [ [ "source", job_post.source_url ], [ "posting", job_post.posting_url ] ].each do |role, original_url|
      identity_key = JobUrlIdentity.key(original_url)
      next unless identity_key

      identity = job_post.url_identities.find_or_initialize_by(role:, original_url:)
      identity.identity_key = identity_key
      identity.save! if identity.new_record? || identity.changed?
    end
  end
end
