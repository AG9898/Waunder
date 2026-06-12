# Sends a VAPID-signed Web Push message to every stored PushSubscription.
#
# This is the single place that talks to the Web Push gateway. It follows the
# same pattern as OpenrouterClient: it reads its credentials from the
# environment and exposes a `transport:` seam so specs can inject a fake push
# client and never send a real push.
#
# Guardrails:
# - Live sends are guarded behind VAPID key presence: when VAPID_PUBLIC_KEY or
#   VAPID_PRIVATE_KEY is missing the dispatcher no-ops (returns a `skipped`
#   Result) instead of raising, so the digest job never breaks on a missing key.
# - When there are no subscriptions the dispatcher no-ops as well.
# - A delivery that fails with a 404/410 (subscription gone) prunes that stored
#   subscription; other per-subscription errors are logged and skipped so one
#   dead endpoint can't abort the whole dispatch.
class WebPushDispatcher
  # Default transport: the real `web-push` gem. Wrapped so the dispatcher does
  # not depend on the gem's module method directly (and so specs can replace it).
  class WebPushTransport
    def deliver(message:, endpoint:, p256dh:, auth:, vapid:)
      WebPush.payload_send(
        message: message,
        endpoint: endpoint,
        p256dh: p256dh,
        auth: auth,
        vapid: vapid,
        urgency: "normal"
      )
    end
  end

  Result = Struct.new(:status, :delivered, :pruned, keyword_init: true) do
    def sent? = status == "sent"
    def skipped? = status == "skipped"
  end

  STATUS_SENT = "sent".freeze
  STATUS_SKIPPED = "skipped".freeze

  def initialize(transport: nil)
    @transport = transport || WebPushTransport.new
  end

  # Delivers `payload` (a Hash, serialized to JSON) to every subscription.
  # Returns a Result; never raises on a missing key or a single bad endpoint.
  def deliver_all(payload)
    return skip!("missing VAPID keys") unless vapid_configured?

    subscriptions = PushSubscription.all.to_a
    return skip!("no subscriptions") if subscriptions.empty?

    message = payload.to_json
    delivered = 0
    pruned = 0

    subscriptions.each do |subscription|
      case deliver_one(subscription, message)
      when :delivered then delivered += 1
      when :pruned then pruned += 1
      end
    end

    Rails.logger.info("WebPushDispatcher sent delivered=#{delivered} pruned=#{pruned}")
    Result.new(status: STATUS_SENT, delivered: delivered, pruned: pruned)
  end

  private

  attr_reader :transport

  def deliver_one(subscription, message)
    transport.deliver(
      message: message,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh_key,
      auth: subscription.auth_key,
      vapid: vapid_options
    )
    :delivered
  rescue WebPush::ExpiredSubscription, WebPush::InvalidSubscription
    subscription.destroy
    :pruned
  rescue StandardError => e
    # Never log the endpoint (may identify the device); log only the error class.
    Rails.logger.warn("WebPushDispatcher delivery error=#{e.class.name}")
    :error
  end

  def vapid_configured?
    vapid_public_key.present? && vapid_private_key.present?
  end

  def vapid_options
    {
      subject: ENV.fetch("VAPID_SUBJECT", "mailto:owner@example.com"),
      public_key: vapid_public_key,
      private_key: vapid_private_key
    }
  end

  def vapid_public_key = ENV["VAPID_PUBLIC_KEY"].presence
  def vapid_private_key = ENV["VAPID_PRIVATE_KEY"].presence

  def skip!(reason)
    Rails.logger.info("WebPushDispatcher skipped (#{reason})")
    Result.new(status: STATUS_SKIPPED, delivered: 0, pruned: 0)
  end
end
