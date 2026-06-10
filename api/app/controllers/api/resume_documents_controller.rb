module Api
  # Resume ingest endpoint. The primary client is the portfolio project's
  # export pipeline (My_Portfolio), which POSTs the canonical JSON Resume plus
  # the exported PDF/markdown after every resume update (push-on-export). A
  # manual upload UI may use the same endpoint as a fallback.
  #
  # Session-guarded like all /api endpoints. The ingest is deterministic: the
  # JSON Resume is mapped straight into the Profile and a primary
  # ResumeDocument with no LLM/PDF parsing. Sensitive fields are encrypted by
  # the models; raw resume content is never logged.
  class ResumeDocumentsController < BaseController
    def create
      resume_json = parsed_resume_json
      return if performed?

      result = ResumeJsonImporter.call(
        resume_json: resume_json,
        markdown: params[:resume_markdown].presence,
        pdf: params[:resume_pdf],
        title: params[:title].presence,
      )

      render json: resume_payload(result), status: :created
    rescue ResumeJsonImporter::InvalidResumeError => e
      render_unprocessable(e.message)
    end

    private

    # Accept the resume either as a JSON string field (multipart, alongside the
    # PDF upload) or as a nested JSON object (application/json clients).
    def parsed_resume_json
      raw = params[:resume]

      case raw
      when String
        JSON.parse(raw)
      when ActionController::Parameters
        raw.to_unsafe_h.deep_stringify_keys
      when Hash
        raw.deep_stringify_keys
      else
        render_unprocessable("resume is required (JSON Resume object or JSON string)")
        nil
      end
    rescue JSON::ParserError
      render_unprocessable("resume is not valid JSON")
      nil
    end

    def resume_payload(result)
      document = result.resume_document

      {
        resume: {
          id: document.id,
          title: document.title,
          parse_status: document.parse_status,
          parsed_at: document.parsed_at,
          primary: document.primary,
          file_attached: document.file.attached?,
          filename: document.filename
        },
        profile: {
          full_name: result.profile.full_name,
          headline: result.profile.headline
        }
      }
    end

    def render_unprocessable(message)
      render json: { error: { code: "unprocessable", message: message } },
             status: :unprocessable_content
    end
  end
end
