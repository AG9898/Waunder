require "uri"

# Backfills a JobPost's title, company, location, compensation, and description
# from the posting itself.
#
# Manual entry keeps title and company optional, so an import can land with only
# a URL. ManualJobPostImporter stays offline and files those rows under a
# placeholder derived from the URL host ("Linkedin"); this service reads the
# posting afterwards and replaces the placeholder with what the posting actually
# says. It only ever fills blank or placeholder fields, so an owner-supplied
# title or company is never overwritten.
#
# Extraction is deterministic (PostingMetadataFetcher) — never the LLM.
class JobPostEnricher
  STATUS_UPDATED = "updated".freeze
  STATUS_UNCHANGED = "unchanged".freeze
  STATUS_UNAVAILABLE = "unavailable".freeze
  STATUS_SKIPPED = "skipped".freeze

  PLACEHOLDER_TITLES = [ "Manual job entry" ].freeze

  Result = Struct.new(:status, :updated_fields, keyword_init: true) do
    def updated? = status == STATUS_UPDATED
  end

  def initialize(job_post, fetcher: nil)
    @job_post = job_post
    @fetcher = fetcher
  end

  def call
    return Result.new(status: STATUS_SKIPPED, updated_fields: []) if url.blank?

    metadata = fetcher.call
    return Result.new(status: STATUS_UNAVAILABLE, updated_fields: []) unless metadata.ok?

    attributes = fillable_attributes(metadata)
    return Result.new(status: STATUS_UNCHANGED, updated_fields: []) if attributes.empty?

    job_post.update!(attributes)
    Result.new(status: STATUS_UPDATED, updated_fields: attributes.keys.map(&:to_s))
  end

  private

  attr_reader :job_post

  def fetcher
    @fetcher ||= PostingMetadataFetcher.new(url)
  end

  def url
    @url ||= job_post.posting_url.presence || job_post.source_url.presence
  end

  # Only blank fields, plus the title/company placeholders this app writes
  # itself. Anything the owner typed is left alone.
  def fillable_attributes(metadata)
    attributes = {}
    attributes[:title] = metadata.title if metadata.title.present? && placeholder_title?
    attributes[:company] = company_for(metadata.company) if metadata.company.present? && placeholder_company?
    attributes[:description] = metadata.description if metadata.description.present? && job_post.description.blank?
    attributes[:location] = metadata.location if metadata.location.present? && job_post.location.blank?
    attributes[:compensation] = metadata.compensation if metadata.compensation.present? && job_post.compensation.blank?
    attributes
  end

  def placeholder_title?
    return true if job_post.title.blank?
    return false if owner_supplied?("title_provided")

    PLACEHOLDER_TITLES.include?(job_post.title) || job_post.title.casecmp?(host_label.to_s)
  end

  def placeholder_company?
    name = job_post.company&.name
    return true if name.blank?
    return false if owner_supplied?("company_provided")

    name.casecmp?(host_label.to_s) || name.casecmp?("Unknown company")
  end

  # Manual imports record whether the owner filled the optional field. Rows
  # imported before that flag existed fall back to the host-label comparison.
  def owner_supplied?(flag)
    job_post.source_payload.to_h.dig("manual_entry", flag) == true
  end

  # Mirrors ManualJobPostImporter#host_label so the placeholders it writes are
  # recognized here.
  def host_label
    return @host_label if defined?(@host_label)

    @host_label = begin
      host = URI.parse(url).host.to_s.downcase.delete_prefix("www.")
      host.split(".").first&.humanize&.presence
    rescue URI::InvalidURIError
      nil
    end
  end

  def company_for(name)
    Company.find_or_create_by!(name: name)
  end
end
