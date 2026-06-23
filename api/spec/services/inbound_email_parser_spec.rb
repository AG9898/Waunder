require "rails_helper"

RSpec.describe InboundEmailParser do
  def inbound_email(from:, text:)
    InboundEmail.create!(
      provider: "resend",
      event_id: "evt_#{SecureRandom.hex(4)}",
      event_type: "email.received",
      provider_email_id: "email_#{SecureRandom.hex(4)}",
      raw_payload: {
        "id" => "evt_123",
        "type" => "email.received",
        "data" => { "from" => from, "subject" => "Job alert", "text" => text }
      }
    )
  end

  describe "known-sender parsing" do
    it "parses a LinkedIn alert into normalized JobPost rows" do
      text = <<~TEXT
        Jobs for you

        Senior Backend Engineer
        Acme Corp · San Francisco, CA (Remote)
        https://www.linkedin.com/jobs/view/3812345678/

        Platform Engineer
        Globex · New York, NY
        https://www.linkedin.com/jobs/view/3899999999/?refId=abc
      TEXT
      email = inbound_email(from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", text:)

      result = described_class.new(email).call

      expect(result.fallback?).to be(false)
      expect(result.parser.source_name).to eq("linkedin")
      expect(result.job_posts.size).to eq(2)

      first = result.job_posts.first
      expect(first.title).to eq("Senior Backend Engineer")
      expect(first.company.name).to eq("Acme Corp")
      expect(first.location).to eq("San Francisco, CA (Remote)")
      expect(first.posting_url).to eq("https://www.linkedin.com/jobs/view/3812345678/")
      expect(first.source_url).to eq("https://www.linkedin.com/jobs/view/3812345678/")
      expect(first.source).to eq("linkedin")
      expect(first.scoring_status).to eq("pending")

      expect(email.reload.raw_payload.dig("parse_result", "needs_llm_fallback")).to be(false)
    end

    it "parses a real LinkedIn digest (title / tracked URL / Company · Location)" do
      # Mirrors the actual digest layout: per job the job-view link sits BETWEEN
      # the title and the "Company · Location" line, uses /comm/jobs/view/, and
      # is surrounded by image-alt and promo noise.
      text = <<~TEXT
        Your job alert for *artificial intelligence engineer*
        New jobs in Vancouver match your preferences.
        [image: VRIFY]
        <https://www.linkedin.com/comm/jobs/view/4388176608/?trk=eml-x&otpToken=abc>
        Senior Geo Data Scientist
        <https://www.linkedin.com/comm/jobs/view/4388176608/?trk=eml-y&otpToken=abc>
        VRIFY · Canada (Remote)
        [image: University of Calgary]
        5 school alumni
        [image: Microsoft]
        <https://www.linkedin.com/comm/jobs/view/4431317239/?trk=eml-z>
        Software Engineer
        <https://www.linkedin.com/comm/jobs/view/4431317239/?trk=eml-z2>
        Microsoft · Vancouver, BC (Hybrid)
        Actively recruiting
        See all jobs
      TEXT
      email = inbound_email(from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", text:)

      result = described_class.new(email).call

      expect(result.parser.source_name).to eq("linkedin")
      expect(result.job_posts.size).to eq(2)

      first = result.job_posts.first
      expect(first.title).to eq("Senior Geo Data Scientist")
      expect(first.company.name).to eq("VRIFY")
      expect(first.location).to eq("Canada (Remote)")
      expect(first.posting_url).to eq("https://www.linkedin.com/jobs/view/4388176608/")

      second = result.job_posts.last
      expect(second.title).to eq("Software Engineer")
      expect(second.company.name).to eq("Microsoft")
      expect(second.location).to eq("Vancouver, BC (Hybrid)")
      expect(second.posting_url).to eq("https://www.linkedin.com/jobs/view/4431317239/")
    end

    it "parses a native LinkedIn digest (title / company / location / View job: URL)" do
      # Mirrors the email_job_alert_digest_01 template: company and location are
      # on their own lines (no "Company · Location" pair), the link is prefixed
      # with "View job: ", blocks are dash-separated, and some carry a promo
      # line between the location and the link.
      text = <<~TEXT
        Your job alert for software engineer in Vancouver
        New jobs match your preferences.

        AI / ML Engineer
        BPM LLP
        Canada

        This company is actively hiring
        View job: https://www.linkedin.com/comm/jobs/view/4309297029/?trackingId=abc&trk=eml-x

        ---------------------------------------------------------

        Python Developer (Remote)
        Hire Feed
        Canada
        View job: https://www.linkedin.com/comm/jobs/view/4431606257/?trackingId=def&trk=eml-y

        ---------------------------------------------------------

        See all jobs on LinkedIn: https://www.linkedin.com/comm/jobs/search?keywords=software+engineer&originToLandingJobPostings=4309297029,4431606257
      TEXT
      email = inbound_email(from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", text:)

      result = described_class.new(email).call

      expect(result.fallback?).to be(false)
      expect(result.parser.source_name).to eq("linkedin")
      expect(result.job_posts.size).to eq(2)

      first = result.job_posts.first
      expect(first.title).to eq("AI / ML Engineer")
      expect(first.company.name).to eq("BPM LLP")
      expect(first.location).to eq("Canada")
      expect(first.posting_url).to eq("https://www.linkedin.com/jobs/view/4309297029/")

      second = result.job_posts.last
      expect(second.title).to eq("Python Developer (Remote)")
      expect(second.company.name).to eq("Hire Feed")
      expect(second.location).to eq("Canada")
      expect(second.posting_url).to eq("https://www.linkedin.com/jobs/view/4431606257/")
    end

    it "parses an Indeed alert into normalized JobPost rows" do
      text = <<~TEXT
        Staff Data Engineer - Globex Inc (Austin, TX)
        https://www.indeed.com/viewjob?jk=a1b2c3d4e5f6&from=alert
      TEXT
      email = inbound_email(from: "alerts@indeed.com", text:)

      result = described_class.new(email).call

      expect(result.parser.source_name).to eq("indeed")
      post = result.job_posts.sole
      expect(post.title).to eq("Staff Data Engineer")
      expect(post.company.name).to eq("Globex Inc")
      expect(post.location).to eq("Austin, TX")
      expect(post.posting_url).to eq("https://www.indeed.com/viewjob?jk=a1b2c3d4e5f6")
      expect(post.source).to eq("indeed")
    end

    it "parses a Glassdoor alert into normalized JobPost rows" do
      text = <<~TEXT
        Product Manager
        Initech — Remote, US
        https://www.glassdoor.com/job-listing/product-manager-initech-JV_IC123_KO0,15.htm
      TEXT
      email = inbound_email(from: "noreply@glassdoor.com", text:)

      result = described_class.new(email).call

      expect(result.parser.source_name).to eq("glassdoor")
      post = result.job_posts.sole
      expect(post.title).to eq("Product Manager")
      expect(post.company.name).to eq("Initech")
      expect(post.location).to eq("Remote, US")
      expect(post.source).to eq("glassdoor")
    end

    it "parses a manually forwarded Glassdoor 'Jobs for You' digest (.ca, ★ layout, salary)" do
      text = <<~TEXT
        ---------- Forwarded message ---------
        From: Glassdoor Jobs <noreply@glassdoor.com>
        To: <owner@example.com>

        [image: Glassdoor]

        Jobs for You

        See the latest roles at DataAnnotation and more. To help refine this list, search for more jobs.
        <https://www.glassdoor.ca/Job/jobs.htm?sc.occupationParam=AI+Trainer&locId=2285197>

        DataAnnotation 4.1 ★

        AI Training Specialist – Quantitative
        Hamilton
        $55 - $60 (Employer Est.)
        Easy Apply
        <https://www.glassdoor.ca/partner/jobListing.htm?pos=101&jobListingId=1010108476620&cb=1782162147176>
        Jobber 3.5 ★

        Intermediate Software Engineer
        Vancouver
        $107K - $144K (Employer Est.)
        5d
        <https://www.glassdoor.ca/partner/jobListing.htm?pos=103&jobListingId=1010030039818>
      TEXT
      email = inbound_email(from: "owner@example.com", text:)

      result = described_class.new(email).call

      expect(result.fallback?).to be(false)
      expect(result.parser.source_name).to eq("glassdoor")
      expect(result.job_posts.size).to eq(2)

      first = result.job_posts.first
      expect(first.title).to eq("AI Training Specialist – Quantitative")
      expect(first.company.name).to eq("DataAnnotation")
      expect(first.location).to eq("Hamilton")
      expect(first.compensation).to eq("$55 - $60 (Employer Est.)")
      expect(first.source).to eq("glassdoor")
      expect(first.posting_url).to eq("https://www.glassdoor.ca/job-listing/index.htm?jl=1010108476620")
      expect(first.source_url).to include("partner/jobListing.htm")

      second = result.job_posts.second
      expect(second.title).to eq("Intermediate Software Engineer")
      expect(second.company.name).to eq("Jobber")
      expect(second.location).to eq("Vancouver")
      expect(second.compensation).to eq("$107K - $144K (Employer Est.)")
    end

    it "parses a native Glassdoor digest (rated + unrated blocks, nbsp rating, footer links)" do
      nbsp = " "
      text = +""
      text << "Wesgroup Properties is hiring\n"
      text << "Glassdoor [https://www.glassdoor.com/assets/email/brandRefresh/logo.png]\n\n"
      text << "Job alert: Technician\n\n"
      text << "Your job listings for June 22, 2026Technician\n"
      text << "[https://www.glassdoor.com/assets/email/brandRefresh/icons/location-icon.png]Vancouver,\nBC\n\n"
      # UNRATED first block — the email preamble above must not leak into it.
      text << "Flash Pharmacy\n\nAI Developer\n\nVancouver\n\n$70K (Employer Est.)\n\n"
      text << "[https://www.glassdoor.com/assets/email/brandRefresh/icons/easy-apply-icon.png]\n\nEasy Apply\n\n9h\n\n"
      text << "[https://www.glassdoor.ca/partner/jobListing.htm?pos=101&jobListingId=1010176128342&cb=1]\n\n"
      # RATED block — avatar/logo images and an nbsp between company and rating.
      text << "avatar\n[https://media.glassdoor.com/sql/123/logo.png]\n\n"
      text << "Underhill Geomatics#{nbsp}4.3 ★\n\nCAD Technician - Burnaby Office\n\nBurnaby\n\n$30 - $37 (Employer Est.)\n\n"
      text << "[https://www.glassdoor.com/assets/email/brandRefresh/icons/easy-apply-icon.png]\n\nEasy Apply\n\n10d\n\n"
      text << "[https://www.glassdoor.ca/partner/jobListing.htm?pos=102&jobListingId=1010166876507]\n"
      text << "[https://www.glassdoor.ca/brand-views?o=brandview-pixel&p=xyz]\n\n"
      # Footer related-jobs "create alert" redirect link MUST be ignored.
      text << "research engineer Create\n"
      text << "[https://www.glassdoor.ca/job-listing/api/rjtRedirect?loc=Vancouver,\nBC&keywords=research engineer]\n"

      email = inbound_email(from: "noreply@glassdoor.com", text:)

      result = described_class.new(email).call

      expect(result.fallback?).to be(false)
      expect(result.parser.source_name).to eq("glassdoor")
      expect(result.job_posts.size).to eq(2)

      flash = result.job_posts.find { |p| p.company.name == "Flash Pharmacy" }
      expect(flash.title).to eq("AI Developer")
      expect(flash.location).to eq("Vancouver")
      expect(flash.compensation).to eq("$70K (Employer Est.)")
      expect(flash.posting_url).to eq("https://www.glassdoor.ca/job-listing/index.htm?jl=1010176128342")

      cad = result.job_posts.find { |p| p.title == "CAD Technician - Burnaby Office" }
      expect(cad.company.name).to eq("Underhill Geomatics")
      expect(cad.location).to eq("Burnaby")
      expect(cad.compensation).to eq("$30 - $37 (Employer Est.)")

      expect(result.job_posts.map(&:title)).to all(satisfy { |t| t !~ /easy apply/i && t !~ /\A\$/ })
    end

    it "ignores the Glassdoor header search link and does not treat it as a posting" do
      text = <<~TEXT
        From: Glassdoor Jobs <noreply@glassdoor.com>

        Jobs for You
        <https://www.glassdoor.ca/Job/jobs.htm?sc.occupationParam=AI+Trainer>
      TEXT
      email = inbound_email(from: "owner@example.com", text:)

      result = described_class.new(email).call

      expect(result.job_posts).to be_empty
      expect(result.fallback?).to be(true)
    end

    it "reuses an existing company instead of duplicating it" do
      existing = Company.create!(name: "Acme Corp")
      text = <<~TEXT
        Senior Backend Engineer
        Acme Corp · San Francisco, CA
        https://www.linkedin.com/jobs/view/3812345678/
      TEXT
      email = inbound_email(from: "jobs@linkedin.com", text:)

      expect { described_class.new(email).call }.not_to change(Company, :count)
      expect(JobPost.last.company).to eq(existing)
    end

    it "matches a forwarded alert via the original sender in the body" do
      text = <<~TEXT
        ---------- Forwarded message ---------
        From: LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>

        Senior Backend Engineer
        Acme Corp · San Francisco, CA
        https://www.linkedin.com/jobs/view/3812345678/
      TEXT
      # Envelope From is the forwarder, not LinkedIn.
      email = inbound_email(from: "Aden Guo <aden.guowe@gmail.com>", text:)

      result = described_class.new(email).call

      expect(result.fallback?).to be(false)
      expect(result.parser.source_name).to eq("linkedin")
      expect(result.job_posts.size).to eq(1)
    end

    it "does not duplicate a JobPost when the same posting URL is parsed twice" do
      text = <<~TEXT
        Senior Backend Engineer
        Acme Corp · San Francisco, CA
        https://www.linkedin.com/jobs/view/3812345678/
      TEXT
      first = inbound_email(from: "jobs@linkedin.com", text:)
      described_class.new(first).call

      second = inbound_email(from: "jobs@linkedin.com", text:)
      expect { described_class.new(second).call }.not_to change(JobPost, :count)
    end
  end

  describe "LLM fallback" do
    it "flags unknown senders for fallback and never creates a JobPost" do
      email = inbound_email(
        from: "alerts@unknownboard.example",
        text: "Some Role at Some Company https://unknownboard.example/jobs/1"
      )

      expect do
        result = described_class.new(email).call
        expect(result.fallback?).to be(true)
        expect(result.parser).to be_nil
        expect(result.job_posts).to be_empty
      end.not_to change(JobPost, :count)

      parse_result = email.reload.raw_payload.fetch("parse_result")
      expect(parse_result["needs_llm_fallback"]).to be(true)
      expect(parse_result["status"]).to eq("unknown_sender")
      expect(email.raw_payload.dig("data", "text")).to include("unknownboard.example")
    end

    it "flags a known sender whose body yields no postings for fallback" do
      email = inbound_email(
        from: "jobalerts-noreply@linkedin.com",
        text: "You have new recommendations. Open LinkedIn to view them."
      )

      result = described_class.new(email).call

      expect(result.fallback?).to be(true)
      expect(result.parser.source_name).to eq("linkedin")
      expect(result.job_posts).to be_empty
      parse_result = email.reload.raw_payload.fetch("parse_result")
      expect(parse_result["status"]).to eq("matched_no_postings")
      expect(parse_result["needs_llm_fallback"]).to be(true)
    end
  end
end
