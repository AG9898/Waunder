# Deterministic ApplicationRoute resolver.
#
# Given a normalized JobPost, this service detects the application `route_type`
# from URL patterns (greenhouse / lever / ashby / workday / linkedin / indeed /
# glassdoor / company_careers / unknown) and ranks the available URLs to a
# single recommended application route using a fixed preference order:
#
#   direct ATS / company application URL
#     > company careers page
#     > job-board external apply
#     > LinkedIn / Indeed / Glassdoor apply
#     > manual only
#
# It records a `route_confidence` reflecting how strong the detected signal is.
# Resolution is entirely deterministic and performs no network or LLM calls.
# When no URL pattern matches any known host, `route_type` is `unknown`,
# `recommended_route` is `manual`, and `needs_llm_fallback?` is true so the
# pipeline can defer to the LLM only in that case.
class ApplicationRouteResolver
  # Maps a detected host signal to the canonical ApplicationRoute#route_type.
  # The bare board names (linkedin/indeed/glassdoor) resolve to their
  # easy/quick-apply route_type values stored on the model.
  HOST_PATTERNS = [
    { route_type: "greenhouse",          confidence: 0.99, matchers: [ /(?:^|\.)greenhouse\.io$/, /(?:^|\.)boards\.greenhouse\.io$/, /(?:^|\.)job-boards\.greenhouse\.io$/ ] },
    { route_type: "lever",               confidence: 0.99, matchers: [ /(?:^|\.)lever\.co$/, /(?:^|\.)jobs\.lever\.co$/ ] },
    { route_type: "ashby",               confidence: 0.99, matchers: [ /(?:^|\.)ashbyhq\.com$/, /(?:^|\.)jobs\.ashbyhq\.com$/ ] },
    { route_type: "workday",             confidence: 0.95, matchers: [ /(?:^|\.)myworkdayjobs\.com$/, /(?:^|\.)myworkday\.com$/, /(?:^|\.)workday\.com$/ ] },
    { route_type: "linkedin_easy_apply", confidence: 0.90, matchers: [ /(?:^|\.)linkedin\.com$/ ] },
    { route_type: "indeed_apply",        confidence: 0.90, matchers: [ /(?:^|\.)indeed\.com$/ ] },
    { route_type: "glassdoor_apply",     confidence: 0.90, matchers: [ /(?:^|\.)glassdoor\.(?:com|ca)$/, /(?:^|\.)glassdoor\.co\.[a-z]+$/ ] }
  ].freeze

  # Recommended-route preference order (lower index = more preferred). The
  # recommended_route string is independent of route_type and captures *how* the
  # user should apply.
  RECOMMENDED_DIRECT_ATS    = "direct_ats"
  RECOMMENDED_COMPANY       = "company_careers"
  RECOMMENDED_BOARD_EXTERNAL = "board_external_apply"
  RECOMMENDED_JOB_BOARD     = "job_board_apply"
  RECOMMENDED_MANUAL        = "manual"

  # route_type values that represent a direct, automatable ATS application.
  DIRECT_ATS_ROUTE_TYPES = %w[greenhouse lever ashby workday].freeze
  # route_type values that represent a job-board quick/easy apply.
  JOB_BOARD_ROUTE_TYPES = %w[linkedin_easy_apply indeed_apply glassdoor_apply].freeze

  Resolution = Struct.new(
    :route_type,
    :recommended_route,
    :route_confidence,
    :application_url,
    :canonical_posting_url,
    :source_url,
    :needs_llm_fallback,
    keyword_init: true
  ) do
    def needs_llm_fallback? = needs_llm_fallback
  end

  def initialize(job_post)
    @job_post = job_post
  end

  # Resolve and persist the ApplicationRoute for the job post, returning the
  # Resolution. Idempotent: re-running updates the existing route record.
  def call
    resolution = resolve

    route = @job_post.application_route || @job_post.build_application_route
    route.assign_attributes(
      route_type: resolution.route_type,
      recommended_route: resolution.recommended_route,
      route_confidence: resolution.route_confidence,
      application_url: resolution.application_url,
      canonical_posting_url: resolution.canonical_posting_url,
      source_url: resolution.source_url
    )
    route.save!

    resolution
  end

  # Pure resolution without persistence. Useful for tests and callers that only
  # need the decision.
  def resolve
    candidates = candidate_urls
    detection = detect(candidates)

    Resolution.new(
      route_type: detection[:route_type],
      recommended_route: detection[:recommended_route],
      route_confidence: detection[:route_confidence],
      application_url: detection[:application_url],
      canonical_posting_url: @job_post.posting_url.presence,
      source_url: @job_post.source_url.presence,
      needs_llm_fallback: detection[:route_type] == "unknown"
    )
  end

  private

  attr_reader :job_post

  # URLs to inspect, in the order they should win ties. The posting URL is the
  # most authoritative application target; source_url is the alert/board link.
  def candidate_urls
    [ job_post.posting_url, job_post.source_url ].map { |u| u&.strip.presence }.compact.uniq
  end

  def detect(urls)
    urls.each do |url|
      host = host_for(url)
      next if host.nil?

      pattern = HOST_PATTERNS.find { |p| p[:matchers].any? { |m| host.match?(m) } }
      next if pattern.nil?

      return build_detection(pattern, url)
    end

    # No known host matched: detection is unknown -> manual, defer to LLM.
    {
      route_type: "unknown",
      recommended_route: RECOMMENDED_MANUAL,
      route_confidence: 0.0,
      application_url: urls.first
    }
  end

  def build_detection(pattern, url)
    route_type = pattern[:route_type]
    {
      route_type: route_type,
      recommended_route: recommended_for(route_type),
      route_confidence: pattern[:confidence],
      application_url: url
    }
  end

  def recommended_for(route_type)
    return RECOMMENDED_DIRECT_ATS if DIRECT_ATS_ROUTE_TYPES.include?(route_type)
    return RECOMMENDED_JOB_BOARD if JOB_BOARD_ROUTE_TYPES.include?(route_type)

    RECOMMENDED_MANUAL
  end

  def host_for(url)
    return nil if url.blank?

    uri = URI.parse(url)
    host = uri.host
    return nil if host.blank?

    host.downcase.delete_prefix("www.")
  rescue URI::InvalidURIError
    nil
  end
end
