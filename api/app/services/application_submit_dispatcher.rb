# Validates and dispatches an approved Application submit task to the worker.
#
# This is the Rails-side trusted-submit gate: it refuses unapproved
# applications, unsupported ATS targets, malformed autofill payloads, and any
# answer that looks unresolved or sensitive. The worker repeats its own safety
# checks when it executes the task.
class ApplicationSubmitDispatcher
  SUPPORTED_ATS = %w[
    greenhouse
    lever
    ashby
  ].freeze

  LINKEDIN_ATS = "linkedin_easy_apply".freeze

  SENSITIVE_FIELD_PATTERNS = [
    /salary|compensation|pay\s*expectation/i,
    /sponsor|visa|work\s*authorization|require.*sponsorship/i,
    /disab/i,
    /veteran|military/i,
    /gender|sex|race|ethnic|hispanic|latino/i,
    /sexual\s*orientation/i,
    /ssn|social\s*security|national\s*id/i,
    /date\s*of\s*birth|dob|\bage\b/i
  ].freeze

  UNRESOLVED_FIELD_PATTERNS = [
    /unknown/i,
    /unresolved/i,
    /requires?.*review/i,
    /manual.*review/i
  ].freeze

  Result = Struct.new(:ok, :code, :message, :payload, keyword_init: true) do
    def ok? = ok
  end

  def self.safety_warnings(payload)
    return [] unless payload.is_a?(Hash)

    Array(payload.deep_stringify_keys["answers"]).filter_map do |answer|
      next unless answer.is_a?(Hash)

      field = answer.deep_stringify_keys["field"].to_s.strip
      next if field.blank?

      if UNRESOLVED_FIELD_PATTERNS.any? { |pattern| pattern.match?(field) }
        { "field" => field, "code" => "unresolved_field", "message" => "Needs manual review" }
      elsif SENSITIVE_FIELD_PATTERNS.any? { |pattern| pattern.match?(field) }
        { "field" => field, "code" => "sensitive_field", "message" => "Needs manual review" }
      end
    end
  end

  def initialize(application)
    @application = application
  end

  def call
    return failure("approval_required", "Application must be approved before submit") unless approved?
    return failure("draft_required", "Application draft is required before submit") if draft.nil?

    payload = normalized_payload
    return payload unless payload.ok?

    task_payload = payload.payload
    return failure("unsupported_ats", "ATS target is not supported for trusted submit") unless supported_ats?(task_payload["ats"])

    clean = clean_payload?(task_payload)
    return clean unless clean.ok?

    WorkerDispatchJob.perform_later(application, task_payload)
    application.audit_events.create!(
      event_type: "submit_dispatched",
      status: application.status,
      metadata: {
        "ats" => task_payload["ats"],
        "job_id" => application.job_post_id
      }
    )

    Result.new(ok: true, code: "dispatched", message: "Submit dispatched", payload: task_payload)
  end

  private

  attr_reader :application

  def approved?
    application.status == "approved" && application.approved_at.present?
  end

  def draft
    application.application_draft
  end

  def normalized_payload
    payload = draft.autofill_payload
    return failure("invalid_payload", "Autofill payload must be an object") unless payload.is_a?(Hash)

    payload = payload.deep_stringify_keys
    payload["application_id"] ||= application.id

    Result.new(ok: true, payload: payload)
  end

  def supported_ats?(ats)
    supported_ats.include?(ats)
  end

  def supported_ats
    return SUPPORTED_ATS + [ LINKEDIN_ATS ] if linkedin_easy_apply_enabled?

    SUPPORTED_ATS
  end

  def linkedin_easy_apply_enabled?
    ActiveModel::Type::Boolean.new.cast(ENV.fetch("LINKEDIN_EASY_APPLY_ENABLED", "false"))
  end

  def clean_payload?(payload)
    return failure("invalid_payload", "Autofill payload is missing apply_url") if payload["apply_url"].blank?

    answers = payload["answers"]
    return failure("invalid_payload", "Autofill payload answers must be an array") unless answers.is_a?(Array)

    answers.each do |answer|
      result = clean_answer?(answer)
      return result unless result.ok?
    end

    Result.new(ok: true)
  end

  def clean_answer?(answer)
    return failure("invalid_payload", "Autofill answer must be an object") unless answer.is_a?(Hash)

    answer = answer.deep_stringify_keys
    field = answer["field"].to_s.strip
    value = answer["value"].to_s.strip

    return failure("invalid_payload", "Autofill answer field and value are required") if field.blank? || value.blank?

    if unresolved_field?(field)
      return failure("unsafe_payload", "Autofill payload contains unresolved fields")
    end

    if sensitive_field?(field)
      return failure("unsafe_payload", "Autofill payload contains sensitive fields")
    end

    Result.new(ok: true)
  end

  def unresolved_field?(field)
    UNRESOLVED_FIELD_PATTERNS.any? { |pattern| pattern.match?(field) }
  end

  def sensitive_field?(field)
    SENSITIVE_FIELD_PATTERNS.any? { |pattern| pattern.match?(field) }
  end

  def failure(code, message)
    Result.new(ok: false, code: code, message: message)
  end
end
