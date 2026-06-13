module Api
  # Latest daily digest of recently scored JobPosts for the PWA landing screen.
  # Read-only: it reuses DailyDigestBuilder's selection of recently scored,
  # top-ranked postings and never triggers scoring or the LLM.
  class DigestController < BaseController
    def show
      posts = DailyDigestBuilder.new.posts

      render json: {
        digest: {
          date: Date.current.iso8601,
          jobs: posts.map { |post| serialize_summary(post) }
        }
      }
    end

    private

    def serialize_summary(post)
      {
        id: post.id,
        title: post.title,
        company: post.company&.name,
        match_score: post.match_score,
        scoring_status: post.scoring_status,
        summary: post.summary
      }
    end
  end
end
