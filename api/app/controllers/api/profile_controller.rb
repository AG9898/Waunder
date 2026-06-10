module Api
  # Read and update the single-user structured profile. Session-guarded.
  # Sensitive fields are encrypted at rest by the model and never serialized
  # back in full — only presence flags are exposed for contact details.
  class ProfileController < BaseController
    def show
      render json: profile_payload(current_profile)
    end

    def update
      profile = current_profile
      profile.assign_attributes(profile_params)

      if profile.save
        render json: profile_payload(profile)
      else
        render json: { error: { code: "unprocessable", message: profile.errors.full_messages.join(", ") } },
               status: :unprocessable_content
      end
    end

    private

    def current_profile
      Profile.first_or_initialize.tap do |profile|
        profile.full_name ||= ""
      end
    end

    def profile_params
      params.require(:profile).permit(
        :full_name, :headline, :summary, :location,
        :email, :phone, :street_address,
        :linkedin_url, :github_url, :portfolio_url,
        work_history: [], education: [], skills: []
      )
    end

    # Never echo raw sensitive contact details back to the client; expose only
    # whether they are set so the UI can render state without leaking PII.
    def profile_payload(profile)
      {
        profile: {
          full_name: profile.full_name,
          headline: profile.headline,
          summary: profile.summary,
          location: profile.location,
          linkedin_url: profile.linkedin_url,
          github_url: profile.github_url,
          portfolio_url: profile.portfolio_url,
          work_history: profile.work_history,
          education: profile.education,
          skills: profile.skills,
          contact: {
            email_present: profile.email.present?,
            phone_present: profile.phone.present?,
            street_address_present: profile.street_address.present?
          },
          resume: resume_summary(profile)
        }
      }
    end

    def resume_summary(profile)
      document = profile.resume_documents.find_by(primary: true)
      return nil unless document

      {
        title: document.title,
        parse_status: document.parse_status,
        parsed_at: document.parsed_at,
        file_attached: document.file.attached?,
        filename: document.filename
      }
    end
  end
end
