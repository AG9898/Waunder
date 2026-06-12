# Builds the daily digest payload from recently scored JobPosts.
#
# The digest is the decision-support summary the owner receives once a day as a
# Web Push notification: the count of newly scored postings in the window and a
# short ranked list of the best matches. It reads only already-scored data
# (JobScorer/ScoreJobPostJob writes it) and never calls the LLM itself.
class DailyDigestBuilder
  DEFAULT_WINDOW = 24.hours
  TOP_N = 5

  def initialize(window: DEFAULT_WINDOW, now: Time.current)
    @window = window
    @now = now
  end

  # Returns a Hash payload (Web Push notification shape) or nil when there is
  # nothing worth notifying about in the window.
  def call
    posts = recent_scored_posts
    return nil if posts.empty?

    {
      title: title_for(posts.size),
      body: body_for(posts),
      data: { url: "/", count: posts.size }
    }
  end

  private

  attr_reader :window, :now

  def recent_scored_posts
    JobPost
      .where(scoring_status: JobScorer::STATUS_SCORED)
      .where(scored_at: window.ago(now)..now)
      .order(Arel.sql("match_score DESC NULLS LAST"), scored_at: :desc)
      .limit(TOP_N)
      .to_a
  end

  def title_for(count)
    count == 1 ? "1 new job match" : "#{count} new job matches"
  end

  def body_for(posts)
    posts.map { |post| line_for(post) }.join("\n")
  end

  def line_for(post)
    parts = [ post.title ]
    parts << post.company&.name
    score = post.match_score
    label = parts.compact.join(" @ ")
    score ? "#{label} (#{score})" : label
  end
end
