# Normalizes owner-submitted job links or pasted posting text into a JobPost.
#
# Manual entry is the fallback ingestion path for postings found outside
# forwarded job-alert email. It stays deterministic: no network fetch and no LLM
# extraction during normalization.
class ManualJobPostImporter
  IMPORT_NEW = "new"
  IMPORT_ALREADY_TRACKED = "already_tracked"
  IMPORT_ALREADY_SUBMITTED = "already_submitted"
  MATCH_EVENT_TYPE = "manual_import_matched"

  Result = Struct.new(:job_post, :status, :application, :application_url, :errors, keyword_init: true) do
    def ok? = errors.empty?
    def new? = status == IMPORT_NEW
  end

  MatchConflictError = Class.new(StandardError)

  def initialize(params)
    @params = params.to_h.deep_symbolize_keys
  end

  def call
    errors = validation_errors
    return Result.new(job_post: nil, errors: errors) if errors.any?

    JobPost.transaction { import! }
  rescue ActiveRecord::RecordInvalid => e
    Result.new(job_post: nil, errors: e.record.errors.full_messages)
  rescue MatchConflictError => e
    Result.new(job_post: nil, errors: [ e.message ])
  end

  private

  attr_reader :params

  def import!
    job_post = matched_job_post
    return matched_result(job_post) if job_post

    job_post = create_job_post!
    attach_aliases!(job_post)
    Result.new(
      job_post: job_post,
      status: IMPORT_NEW,
      application: nil,
      application_url: application_url,
      errors: []
    )
  end

  def matched_job_post
    ids = JobPostUrlIdentity.where(identity_key: identity_keys).lock.pluck(:job_post_id).uniq
    raise MatchConflictError, "Supplied URLs match different tracked jobs" if ids.many?

    JobPost.lock.find(ids.sole) if ids.one?
  end

  def matched_result(job_post)
    added_aliases = attach_aliases!(job_post)
    application = submitted_application(job_post) || latest_application(job_post)
    status = application&.status == "submitted" ? IMPORT_ALREADY_SUBMITTED : IMPORT_ALREADY_TRACKED

    job_post.audit_events.create!(
      event_type: MATCH_EVENT_TYPE,
      metadata: {
        "status" => status,
        "identity_keys" => identity_keys.sort,
        "added_aliases" => added_aliases
      }
    )

    Result.new(
      job_post: job_post,
      status: status,
      application: application,
      application_url: application_url,
      errors: []
    )
  end

  def create_job_post!
    company = Company.find_or_create_by!(name: company_name)

    JobPost.create!(
      company: company,
      title: title,
      description: text,
      posting_url: url,
      source_url: url,
      source: "manual",
      source_payload: source_payload,
      scoring_status: "pending"
    )
  end

  def validation_errors
    errors = []
    errors << "Provide a URL or pasted job text" if url.blank? && text.blank?
    errors << "URL must be an HTTP or HTTPS URL" if url.present? && !http_url?(url)
    errors << "Application URL must be an HTTP or HTTPS URL" if application_url.present? && !http_url?(application_url)
    errors
  end

  def attach_aliases!(job_post)
    url_aliases.filter_map do |url_alias|
      identity = job_post.url_identities.find_or_initialize_by(
        role: url_alias.fetch(:role),
        original_url: url_alias.fetch(:original_url)
      )
      added = identity.new_record?
      identity.identity_key = url_alias.fetch(:identity_key)
      identity.save! if identity.new_record? || identity.changed?
      url_alias if added
    end
  end

  def url_aliases
    @url_aliases ||= [
      [ "source", url ],
      [ "posting", url ],
      [ "application", application_url ]
    ].filter_map do |role, original_url|
      identity_key = JobUrlIdentity.key(original_url)
      { role: role, original_url: original_url, identity_key: identity_key } if identity_key
    end
  end

  def identity_keys
    @identity_keys ||= url_aliases.pluck(:identity_key).uniq
  end

  def submitted_application(job_post)
    job_post.applications.where(status: "submitted").order(created_at: :desc).first
  end

  def latest_application(job_post)
    job_post.applications.order(created_at: :desc).first
  end

  def http_url?(value)
    uri = URI.parse(value)
    uri.host.present? && %w[http https].include?(uri.scheme)
  rescue URI::InvalidURIError
    false
  end

  def title
    params[:title].presence || first_text_line || host_label || "Manual job entry"
  end

  def company_name
    params[:company].presence || host_label || "Unknown company"
  end

  def first_text_line
    text.to_s.lines.map(&:strip).find(&:present?)
  end

  def host_label
    return if url.blank?

    host = URI.parse(url).host.to_s.downcase.delete_prefix("www.")
    host.split(".").first&.humanize&.presence
  rescue URI::InvalidURIError
    nil
  end

  def source_payload
    {
      "manual_entry" => {
        "url_provided" => url.present?,
        "text_provided" => text.present?,
        "application_url_provided" => application_url.present?
      }
    }
  end

  def url
    @url ||= params[:url].presence || params[:posting_url].presence
  end

  def text
    @text ||= params[:text].presence || params[:pasted_text].presence || params[:description].presence
  end

  def application_url
    @application_url ||= params[:application_url].presence
  end
end
