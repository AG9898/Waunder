require "rails_helper"

RSpec.describe ApplicationRouteResolver do
  def job_post_with(posting_url: nil, source_url: nil)
    company = Company.find_or_create_by!(name: "Example Co")
    JobPost.create!(
      company: company,
      title: "Product Engineer",
      posting_url: posting_url,
      source_url: source_url,
      scoring_status: "pending"
    )
  end

  describe "#resolve route_type detection from URL patterns" do
    {
      "https://boards.greenhouse.io/acme/jobs/123" => "greenhouse",
      "https://job-boards.greenhouse.io/acme/jobs/9" => "greenhouse",
      "https://jobs.lever.co/acme/abc-123" => "lever",
      "https://jobs.ashbyhq.com/acme/posting" => "ashby",
      "https://acme.wd1.myworkdayjobs.com/External/job/123" => "workday",
      "https://www.linkedin.com/jobs/view/12345" => "linkedin_easy_apply",
      "https://www.indeed.com/viewjob?jk=abc" => "indeed_apply",
      "https://www.glassdoor.com/job-listing/foo" => "glassdoor_apply"
    }.each do |url, expected_type|
      it "maps #{url} to #{expected_type}" do
        resolution = described_class.new(job_post_with(posting_url: url)).resolve

        expect(resolution.route_type).to eq(expected_type)
        expect(resolution.route_confidence).to be > 0
        expect(resolution).not_to be_needs_llm_fallback
      end
    end

    it "returns unknown and flags LLM fallback when no pattern matches" do
      resolution = described_class.new(
        job_post_with(posting_url: "https://careers.acme.example.com/jobs/5")
      ).resolve

      expect(resolution.route_type).to eq("unknown")
      expect(resolution.route_confidence).to eq(0.0)
      expect(resolution.recommended_route).to eq("manual")
      expect(resolution).to be_needs_llm_fallback
    end

    it "returns unknown when no URLs are present" do
      resolution = described_class.new(job_post_with).resolve

      expect(resolution.route_type).to eq("unknown")
      expect(resolution).to be_needs_llm_fallback
    end
  end

  describe "#resolve recommended-route preference order" do
    it "recommends direct_ats for ATS hosts" do
      resolution = described_class.new(
        job_post_with(posting_url: "https://jobs.lever.co/acme/x")
      ).resolve

      expect(resolution.recommended_route).to eq("direct_ats")
    end

    it "recommends job_board_apply for board hosts" do
      resolution = described_class.new(
        job_post_with(posting_url: "https://www.indeed.com/viewjob?jk=abc")
      ).resolve

      expect(resolution.recommended_route).to eq("job_board_apply")
    end

    it "prefers a direct ATS posting_url over a job-board source_url" do
      resolution = described_class.new(
        job_post_with(
          posting_url: "https://boards.greenhouse.io/acme/jobs/1",
          source_url: "https://www.linkedin.com/jobs/view/1"
        )
      ).resolve

      expect(resolution.route_type).to eq("greenhouse")
      expect(resolution.recommended_route).to eq("direct_ats")
      expect(resolution.application_url).to eq("https://boards.greenhouse.io/acme/jobs/1")
    end

    it "falls back to a job-board source_url when the posting_url host is unknown" do
      resolution = described_class.new(
        job_post_with(
          posting_url: "https://careers.acme.example.com/jobs/5",
          source_url: "https://www.linkedin.com/jobs/view/2"
        )
      ).resolve

      expect(resolution.route_type).to eq("linkedin_easy_apply")
      expect(resolution.recommended_route).to eq("job_board_apply")
    end
  end

  describe "#resolve determinism" do
    it "does not invoke the LLM and is stable across repeated runs" do
      job_post = job_post_with(posting_url: "https://jobs.ashbyhq.com/acme/p")
      resolver = described_class.new(job_post)

      first = resolver.resolve
      second = resolver.resolve

      expect(first.to_h).to eq(second.to_h)
      expect(defined?(OpenrouterClient)).to be_nil.or be_falsey
    end

    it "tolerates malformed URLs without raising" do
      resolution = described_class.new(
        job_post_with(posting_url: "http://[not a url")
      ).resolve

      expect(resolution.route_type).to eq("unknown")
    end
  end

  describe "#call persistence" do
    it "creates and persists the ApplicationRoute for the job post" do
      job_post = job_post_with(posting_url: "https://boards.greenhouse.io/acme/jobs/1")

      resolution = described_class.new(job_post).call
      route = job_post.reload.application_route

      expect(route).to be_present
      expect(route.route_type).to eq("greenhouse")
      expect(route.recommended_route).to eq("direct_ats")
      expect(route.route_confidence.to_f).to eq(resolution.route_confidence)
      expect(route.application_url).to eq("https://boards.greenhouse.io/acme/jobs/1")
      expect(route.canonical_posting_url).to eq("https://boards.greenhouse.io/acme/jobs/1")
    end

    it "updates the existing route on re-run (idempotent)" do
      job_post = job_post_with(posting_url: "https://jobs.lever.co/acme/x")
      described_class.new(job_post).call

      job_post.update!(posting_url: "https://jobs.ashbyhq.com/acme/p")
      described_class.new(job_post).call

      expect(job_post.reload.application_route.route_type).to eq("ashby")
      expect(ApplicationRoute.where(job_post: job_post).count).to eq(1)
    end
  end
end
