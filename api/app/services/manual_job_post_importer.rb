# Normalizes owner-submitted job links or pasted posting text into a JobPost.
#
# Manual entry is the fallback ingestion path for postings found outside
# forwarded job-alert email. It stays deterministic: no network fetch and no LLM
# extraction during normalization.
class ManualJobPostImporter
  Result = Struct.new(:job_post, :errors, keyword_init: true) do
    def ok? = errors.empty?
  end

  def initialize(params)
    @params = params.to_h.deep_symbolize_keys
  end

  def call
    errors = validation_errors
    return Result.new(job_post: nil, errors: errors) if errors.any?

    Result.new(job_post: create_job_post!, errors: [])
  rescue ActiveRecord::RecordInvalid => e
    Result.new(job_post: nil, errors: e.record.errors.full_messages)
  end

  private

  attr_reader :params

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
    errors
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
        "text_provided" => text.present?
      }
    }
  end

  def url
    @url ||= params[:url].presence || params[:posting_url].presence
  end

  def text
    @text ||= params[:text].presence || params[:pasted_text].presence || params[:description].presence
  end
end
