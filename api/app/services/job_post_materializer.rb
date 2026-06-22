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

    existing = find_existing
    return existing if existing

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
    # Resolve the application route deterministically right after normalization
    # so downstream scoring/draft jobs have a recommended route.
    ApplicationRouteResolver.new(job_post).call
    job_post
  end

  private

  def find_existing
    url = @posting[:posting_url].presence
    return nil if url.nil?

    JobPost.find_by(posting_url: url)
  end
end
