# Development seed data for local UI preview. Idempotent: clears demo records
# and recreates a representative set covering every PWA screen (digest, job
# feed/detail, application draft review, contacts/outreach, profile).
#
# This is illustrative sample data only — no real LLM calls were made; the
# scored fields below are hand-written so the read-only screens have content.

if Rails.env.production?
  warn "Refusing to seed in production."
  return
end

ActiveRecord::Base.transaction do
  # --- Clean slate for demo records ---
  OutreachDraft.delete_all
  ContactCandidate.delete_all
  ApplicationDraft.delete_all
  AuditEvent.delete_all
  Application.delete_all
  ApplicationRoute.delete_all
  JobPost.delete_all
  Company.delete_all
  ResumeDocument.delete_all
  Profile.delete_all

  # --- Profile (singleton) ---
  profile = Profile.create!(
    full_name: "Aden Guo",
    headline: "Software Engineer — full-stack & ML",
    email: "aden.demo@example.com",
    phone: "+1 555 0100",
    location: "Vancouver, BC",
    linkedin_url: "https://linkedin.com/in/example",
    github_url: "https://github.com/example",
    portfolio_url: "https://example.dev",
    summary: "Full-stack engineer with a focus on Rails APIs, Go services, and applied ML.",
    skills: [ "Ruby on Rails", "Go", "TypeScript", "PostgreSQL", "Playwright", "LLM orchestration" ],
    work_history: [
      { "company" => "Acme Corp", "title" => "Software Engineer", "start" => "2023", "end" => "Present",
        "highlights" => [ "Built API platform", "Led migration to Rails 8" ] },
      { "company" => "Startup Inc", "title" => "Junior Developer", "start" => "2021", "end" => "2023",
        "highlights" => [ "Shipped customer dashboard" ] }
    ],
    education: [
      { "school" => "University of British Columbia", "degree" => "BSc Computer Science", "year" => "2021" }
    ]
  )

  ResumeDocument.create!(
    profile: profile,
    title: "Primary Resume",
    filename: "cv.pdf",
    content_type: "application/pdf",
    primary: true,
    parse_status: "parsed",
    parsed_at: Time.current,
    raw_text: "Aden Guo — Software Engineer. Rails, Go, TypeScript...",
    parsed_structure: { "basics" => { "name" => "Aden Guo" }, "skills" => [ "Rails", "Go" ] }
  )

  # --- Companies + scored JobPosts ---
  jobs_spec = [
    {
      company: "Stripe", domain: "stripe.com",
      title: "Senior Backend Engineer", location: "Remote (US/CA)", remote_status: "remote",
      employment_type: "Full-time", compensation: "$180k–$220k",
      match_score: 92, summary: "Strong fit: Ruby/Rails platform team building payments APIs.",
      relevant: [ "7+ yrs backend", "Ruby on Rails", "Distributed systems" ],
      missing: [ "Payments domain experience" ],
      red_flags: [],
      alignment: "Your Rails 8 migration work maps directly to their platform modernization.",
      strategy: "Apply via Greenhouse; reference the API platform work in your summary.",
      route_type: "greenhouse", recommended: "direct_ats",
      apply_url: "https://boards.greenhouse.io/stripe/jobs/123",
      posting_url: "https://stripe.com/jobs/123"
    },
    {
      company: "Shopify", domain: "shopify.com",
      title: "Staff Software Engineer, Platform", location: "Remote (Canada)", remote_status: "remote",
      employment_type: "Full-time", compensation: "$200k+",
      match_score: 85, summary: "Good fit: Rails monolith at scale, strong infra culture.",
      relevant: [ "Ruby on Rails", "Large-scale systems", "Mentorship" ],
      missing: [ "Staff-level leadership scope", "GraphQL at scale" ],
      red_flags: [ "Role may require more people-leadership than IC work" ],
      alignment: "Your migration leadership is relevant but role leans staff-scope.",
      strategy: "Apply via Lever; emphasize cross-team migration leadership.",
      route_type: "lever", recommended: "direct_ats",
      apply_url: "https://jobs.lever.co/shopify/abc",
      posting_url: "https://shopify.com/careers/abc"
    },
    {
      company: "Linear", domain: "linear.app",
      title: "Full-stack Engineer", location: "Remote", remote_status: "remote",
      employment_type: "Full-time", compensation: "Competitive + equity",
      match_score: 78, summary: "Solid fit: TypeScript product engineering, small team.",
      relevant: [ "TypeScript", "Product sense", "Full-stack" ],
      missing: [ "React deep expertise" ],
      red_flags: [],
      alignment: "Strong on full-stack, lighter on their React-heavy frontend.",
      strategy: "Apply via Ashby; lead with shipped product features.",
      route_type: "ashby", recommended: "direct_ats",
      apply_url: "https://jobs.ashbyhq.com/linear/xyz",
      posting_url: "https://linear.app/careers/xyz"
    },
    {
      company: "Notion", domain: "notion.so",
      title: "Backend Engineer", location: "Hybrid (SF)", remote_status: "hybrid",
      employment_type: "Full-time", compensation: "$170k–$200k",
      match_score: 64, summary: "Partial fit: hybrid SF role, strong backend but location mismatch.",
      relevant: [ "Backend systems", "PostgreSQL" ],
      missing: [ "On-site availability in SF", "Go experience" ],
      red_flags: [ "Hybrid on-site requirement conflicts with remote preference" ],
      alignment: "Technical fit good; location is the main blocker.",
      strategy: "Manual application; clarify remote flexibility before applying.",
      route_type: "unknown", recommended: "manual",
      apply_url: nil,
      posting_url: "https://notion.so/careers/backend"
    }
  ]

  job_posts = jobs_spec.map do |spec|
    company = Company.create!(name: spec[:company], domain: spec[:domain],
                              website_url: "https://#{spec[:domain]}")
    jp = JobPost.create!(
      company: company,
      title: spec[:title],
      location: spec[:location],
      remote_status: spec[:remote_status],
      employment_type: spec[:employment_type],
      compensation: spec[:compensation],
      posting_url: spec[:posting_url],
      source: "seed",
      source_url: spec[:posting_url],
      description: "#{spec[:title]} at #{spec[:company]}. (Seeded demo description.)",
      posted_at: 3.days.ago,
      scoring_status: "scored",
      scored_at: Time.current,
      match_score: spec[:match_score],
      summary: spec[:summary],
      relevant_requirements: spec[:relevant],
      missing_requirements: spec[:missing],
      red_flags: spec[:red_flags],
      resume_alignment_notes: spec[:alignment],
      application_strategy: spec[:strategy]
    )
    ApplicationRoute.create!(
      job_post: jp,
      route_type: spec[:route_type],
      recommended_route: spec[:recommended],
      route_confidence: 0.9,
      application_url: spec[:apply_url],
      canonical_posting_url: spec[:posting_url],
      source_url: spec[:posting_url]
    )
    jp
  end

  # --- Application + draft for the top job (draft review screen) ---
  top = job_posts.first
  application = Application.create!(job_post: top, status: "draft")
  ApplicationDraft.create!(
    application: application,
    cover_letter: "Dear Stripe team,\n\nI'm excited to apply for the Senior Backend " \
                  "Engineer role. My recent work leading a Rails 8 platform migration...",
    resume_emphasis_notes: "Emphasize API platform work and distributed systems experience.",
    structured_answers: [
      { "field" => "years_of_experience", "value" => "7" },
      { "field" => "authorized_to_work", "value" => "Yes" }
    ],
    autofill_payload: {
      "application_id" => application.id,
      "ats" => "greenhouse",
      "apply_url" => "https://boards.greenhouse.io/stripe/jobs/123",
      "answers" => [
        { "field" => "first_name", "value" => "Aden" },
        { "field" => "last_name", "value" => "Guo" },
        { "field" => "email", "value" => "aden.demo@example.com" }
      ]
    }
  )

  # --- Contacts + outreach for the top job ---
  c1 = ContactCandidate.create!(
    job_post: top, name: "Jamie Rivera", title: "Engineering Manager, Payments",
    company_name: "Stripe", linkedin_url: "https://linkedin.com/in/example-jamie",
    relevance_reason: "Hiring manager for the team this role sits on."
  )
  ContactCandidate.create!(
    job_post: top, name: "Sam Patel", title: "Senior Backend Engineer",
    company_name: "Stripe", linkedin_url: "https://linkedin.com/in/example-sam",
    relevance_reason: "Potential teammate; can speak to day-to-day work."
  )
  OutreachDraft.create!(
    contact_candidate: c1,
    loose_template: "warm_intro",
    message: "Hi Jamie — I came across the Senior Backend Engineer opening on your " \
             "team and your platform work really resonated with my recent Rails 8 " \
             "migration. Would love to connect."
  )

  puts "Seeded: #{Company.count} companies, #{JobPost.count} jobs, " \
       "#{Application.count} applications, #{ContactCandidate.count} contacts, " \
       "1 profile."
end
