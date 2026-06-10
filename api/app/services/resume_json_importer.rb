# Deterministically maps a JSON Resume object (https://jsonresume.org/schema)
# into the single-user Profile and a primary ResumeDocument.
#
# The portfolio project (My_Portfolio) is the single source of truth for the
# resume: it maintains src/data/resume.json and exports cv.pdf + cv.md. Because
# that JSON is already clean, canonical structure, Waunder ingests it directly
# instead of parsing a PDF through OCR/LLM extraction. The structured JSON is the
# parsed_structure; the markdown is the raw_text; the PDF is the file a worker
# uploads to an ATS form.
#
# All mapping here is deterministic — no LLM calls. Sensitive fields (email,
# phone, address, raw_text, parsed_structure) are persisted through the models'
# Active Record Encryption and are never logged.
class ResumeJsonImporter
  class InvalidResumeError < StandardError; end

  Result = Struct.new(:profile, :resume_document, keyword_init: true)

  def self.call(...)
    new(...).call
  end

  # resume_json: parsed Hash in JSON Resume schema (required)
  # markdown:    plain-text/markdown rendering of the resume (optional) -> raw_text
  # pdf:         an uploaded PDF file (optional) -> attached file the worker uploads
  # title:       override for the document title (optional)
  def initialize(resume_json:, markdown: nil, pdf: nil, title: nil)
    @resume_json = resume_json
    @markdown = markdown
    @pdf = pdf
    @title = title
  end

  def call
    raise InvalidResumeError, "resume must be a JSON Resume object" unless @resume_json.is_a?(Hash)

    basics = @resume_json["basics"]
    basics = {} unless basics.is_a?(Hash)
    raise InvalidResumeError, "basics.name is required" if basics["name"].to_s.strip.empty?

    profile = nil
    document = nil

    ApplicationRecord.transaction do
      profile = Profile.first_or_initialize
      apply_profile_fields(profile, basics)
      profile.save!

      document = profile.resume_documents.where(primary: true).first_or_initialize
      apply_document_fields(document, basics)
      attach_pdf(document) if @pdf
      document.save!
    end

    Result.new(profile: profile, resume_document: document)
  end

  private

  def apply_profile_fields(profile, basics)
    profile.full_name = basics["name"]
    profile.headline = basics["label"]
    profile.summary = basics["summary"]
    profile.location = format_location(basics["location"])
    profile.email = basics["email"]
    profile.phone = basics["phone"]
    profile.street_address = street_address(basics["location"])
    apply_profile_links(profile, basics)
    profile.work_history = Array(@resume_json["work"])
    profile.education = Array(@resume_json["education"])
    profile.skills = Array(@resume_json["skills"])
  end

  def apply_document_fields(document, basics)
    document.title = @title.presence || basics["label"].presence || "#{basics['name']} resume"
    document.parsed_structure = @resume_json
    document.raw_text = @markdown if @markdown.present?
    # The JSON is authoritative structure, so the document is "parsed" on arrival
    # — no extraction step is pending.
    document.parse_status = "parsed"
    document.parsed_at = Time.current
    document.primary = true
  end

  def attach_pdf(document)
    document.file.attach(@pdf)
    document.content_type = "application/pdf"
    document.filename = pdf_filename
    document.storage_key = document.file.blob&.key
  end

  def pdf_filename
    @pdf.try(:original_filename).presence || "resume.pdf"
  end

  def format_location(location)
    return nil unless location.is_a?(Hash)

    [ location["city"], location["region"], location["countryCode"] ]
      .map { |part| part.to_s.strip }
      .reject(&:empty?)
      .join(", ")
      .presence
  end

  def street_address(location)
    return nil unless location.is_a?(Hash)

    location["address"].presence
  end

  def apply_profile_links(profile, basics)
    profiles = Array(basics["profiles"])
    profile.linkedin_url = network_url(profiles, "linkedin")
    profile.github_url = network_url(profiles, "github")
    profile.portfolio_url = basics["url"].presence
  end

  def network_url(profiles, network)
    entry = profiles.find do |candidate|
      candidate.is_a?(Hash) && candidate["network"].to_s.downcase == network
    end

    entry && entry["url"].presence
  end
end
