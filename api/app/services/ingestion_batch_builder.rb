# Groups recently-ingested JobPosts into "batches" for the ingestion-history view.
#
# There is no persisted link between a JobPost and the inbound email it arrived
# in, so a batch is derived deterministically: postings that share a `source`
# (linkedin/glassdoor/manual/...) and were created in the same tight time window
# belong to one ingestion event (one ParseInboundEmailJob run materializes a
# whole digest's postings within seconds of each other). A new batch starts when
# the gap between consecutive same-source postings exceeds GAP.
#
# Read-only: it never triggers scoring or the LLM. Returns plain Hashes ordered
# newest-first, each carrying its postings so the UI can drill in without a
# second round trip and without needing a stable server-side batch id.
class IngestionBatchBuilder
  # Max gap between consecutive same-source postings that still counts as the
  # same ingestion. One digest's postings are created sub-second apart; distinct
  # alert emails arrive minutes-to-hours apart, so a few minutes separates them
  # cleanly.
  GAP = 3.minutes

  # How far back to look. Single-user app with modest volume; a generous window
  # keeps the whole ingestion history visible without unbounded scans.
  DEFAULT_WINDOW = 90.days

  def initialize(window: DEFAULT_WINDOW, now: Time.current)
    @window = window
    @now = now
  end

  # Returns an Array of batch Hashes, newest first. May be empty.
  def call
    posts = recent_posts
    return [] if posts.empty?

    cluster(posts).map { |group| batch_for(group) }.sort_by { |b| b[:ingested_at] }.reverse
  end

  private

  attr_reader :window, :now

  def recent_posts
    JobPost
      .includes(:company)
      .where(created_at: window.ago(now)..now)
      .order(:source, created_at: :asc)
      .to_a
  end

  # Walks the source-then-time ordered posts, opening a new cluster whenever the
  # source changes or the time gap from the previous same-source post exceeds GAP.
  def cluster(posts)
    clusters = []
    current = nil

    posts.each do |post|
      if current.nil? ||
          post.source != current.last.source ||
          post.created_at - current.last.created_at > GAP
        current = [ post ]
        clusters << current
      else
        current << post
      end
    end

    clusters
  end

  def batch_for(group)
    ingested_at = group.map(&:created_at).max
    sorted = group.sort_by { |p| -(p.match_score || -1) }

    {
      id: batch_id(group.first, ingested_at),
      source: group.first.source,
      ingested_at: ingested_at,
      date: ingested_at.to_date.iso8601,
      count: group.size,
      jobs: sorted.map { |post| serialize_summary(post) }
    }
  end

  # Stable-enough synthetic id for a derived batch: source + first-arrival epoch.
  def batch_id(first_post, _ingested_at)
    "#{first_post.source}-#{first_post.created_at.to_i}"
  end

  def serialize_summary(post)
    {
      id: post.id,
      title: post.title,
      company: post.company&.name,
      source: post.source,
      match_score: post.match_score,
      scoring_status: post.scoring_status,
      summary: post.summary
    }
  end
end
