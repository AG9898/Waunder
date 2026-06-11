module Api
  # Stores browser Web Push subscriptions for the single owner.
  class PushSubscriptionsController < BaseController
    skip_before_action :authenticate_session!, only: :public_key

    def public_key
      render json: { vapid_public_key: ENV.fetch("VAPID_PUBLIC_KEY", nil).to_s }
    end

    def create
      attributes = subscription_attributes
      subscription = PushSubscription.find_or_initialize_by(endpoint: attributes[:endpoint])
      subscription.assign_attributes(attributes)

      if subscription.save
        render json: {
          push_subscription: {
            id: subscription.id,
            endpoint: subscription.endpoint
          }
        }, status: :created
      else
        render json: { error: { code: "unprocessable", message: subscription.errors.full_messages.join(", ") } },
               status: :unprocessable_content
      end
    end

    def destroy
      PushSubscription.find_by(endpoint: unsubscribe_params[:endpoint])&.destroy!

      render json: { status: "ok" }
    end

    private

    def subscription_attributes
      payload = subscription_params

      {
        endpoint: payload[:endpoint],
        p256dh_key: payload.dig(:keys, :p256dh),
        auth_key: payload.dig(:keys, :auth),
        expires_at: expires_at(payload[:expirationTime] || payload[:expiration_time]),
        user_agent: request.user_agent
      }
    end

    def subscription_params
      source = params[:subscription].presence || params
      source.permit(:endpoint, :expirationTime, :expiration_time, keys: %i[p256dh auth])
    end

    def unsubscribe_params
      source = params[:subscription].presence || params
      source.permit(:endpoint)
    end

    def expires_at(value)
      return if value.blank?

      Time.zone.at(value.to_f / 1000.0)
    end
  end
end
