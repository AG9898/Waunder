# Recurring background job that builds the daily digest and dispatches it as a
# VAPID-signed Web Push notification to every stored subscription.
#
# Configured to run on a schedule via config/recurring.yml. The job stays thin:
# DailyDigestBuilder assembles the payload from recently scored JobPosts and
# WebPushDispatcher delivers it. Both no-op gracefully (no digest content, or no
# VAPID key / no subscriptions), so the recurring job is always safe to run.
#
# Live sends are guarded behind VAPID key presence inside WebPushDispatcher; in
# tests the dispatcher's transport is mocked so no real push is ever sent.
class DailyDigestJob < ApplicationJob
  queue_as :default

  def perform
    payload = DailyDigestBuilder.new.call

    if payload.nil?
      Rails.logger.info("DailyDigestJob no-op (no recently scored posts)")
      return
    end

    result = WebPushDispatcher.new.deliver_all(payload)
    Rails.logger.info("DailyDigestJob complete status=#{result.status}")
  end
end
