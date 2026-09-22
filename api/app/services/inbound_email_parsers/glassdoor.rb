module InboundEmailParsers
  # Parses Glassdoor "Jobs for You" job-alert emails.
  #
  # Glassdoor alerts come in two real templates, plus manual forwards of each:
  #
  # 1. RATED block — companies that carry a Glassdoor star rating. Preceded by
  #    an `avatar` line + a company-logo image, then:
  #      Underhill Geomatics 4.3 ★                  <- "Company <rating> ★"
  #      CAD Technician - Burnaby Office            <- title
  #      Burnaby                                    <- location
  #      $30 - $37 (Employer Est.)                  <- salary (optional)
  #      Easy Apply                                 <- apply flag (optional)
  #      10d                                        <- posting age (optional)
  #      [https://www.glassdoor.ca/partner/jobListing.htm?...&jobListingId=123]
  #
  # 2. UNRATED block — companies with no Glassdoor rating. No avatar/logo and
  #    NO "★" line; the company is just the first line, positionally:
  #      Flash Pharmacy                             <- company
  #      AI Developer                               <- title
  #      Vancouver                                  <- location
  #      $70K (Employer Est.)                       <- salary (optional)
  #      Easy Apply / 9h ...                        <- apply flag / age
  #      [https://www.glassdoor.ca/partner/jobListing.htm?...&jobListingId=123]
  #
  # The job link is the deterministic end-of-block anchor (matched on the
  # `job-listing` / `partner/jobListing` path on ANY Glassdoor TLD). RATED
  # blocks anchor on the "Company <rating> ★" line and read forward, so the
  # email preamble before the first rating line is ignored. UNRATED blocks have
  # no anchor, so they are read from the LAST few content lines before the link
  # (after dropping logo/avatar/pixel images, apply-flag/age META, and the
  # salary) — this bounds the first unrated block against the email preamble.
  # The legacy "title / Company — Location" forward layout is still handled.
  #
  # 3. COMPANY-INSIGHTS email ("<Company>: What You Need to Know") — a
  #    separate template, detected by its subject or its "Check out these jobs"
  #    marker line and parsed on its own path (`parse_company_insights`). Its
  #    research sections (salaries, interviews, benefits for jobs already applied
  #    to) are skipped entirely; only the list after the marker is read:
  #      Gatekeeper Systems (Canada)                <- company
  #      [logo.png]https://…/partner/jobListing.htm?…jobListingId=123[pixel]
  #      3.7 ★                                      <- bare rating (optional)
  #      Software Engineer                          <- title
  #      Gatekeeper Systems (Canada) - Abbotsford   <- "Company - Location"
  #      Easy Apply                                 <- apply flag (optional)
  #      [https://…/partner/jobListing.htm?…jobListingId=123]  <- end anchor
  class Glassdoor < Base
    # A Glassdoor application/listing link on any Glassdoor TLD. The trailing
    # `\]` exclusion keeps a native `[https://…]`-bracketed link from absorbing
    # the closing bracket. Excludes the `/Job/jobs.htm` header search link.
    JOB_URL = %r{https?://(?:[\w.-]+\.)?glassdoor\.[a-z.]+/(?:job-listing|partner/jobListing)[^\s)>\]"']*}i
    # The related-jobs "create alert" redirect links in the footer also live on
    # the `/job-listing/` path but are NOT postings — skip them.
    REDIRECT = %r{/job-listing/api/}i
    # The stable numeric listing id carried in the partner-redirect link.
    # The stable numeric listing id carried in the partner-redirect link, or
    # the `jl=` param of a `/job-listing/<slug>.htm?jl=<id>` link.
    LISTING_ID = /(?:jobListingId|[?&]jl)=(\d+)/i
    # A "Company <rating> ★" line — the rated-block anchor (★ is U+2605).
    COMPANY_RATING = /\A(?<company>.+?)\s+\d(?:\.\d+)?\s*★\s*\z/u
    # A salary/compensation line (e.g. "$55 - $60 (Employer Est.)").
    SALARY = /\$\s*[\d.,]+\s*[KkMm]?/
    # Apply-flag / age / boilerplate lines that are never the location.
    META = Regexp.union(
      /\Aeasy apply\z/i,
      /\Ajust posted\z/i,
      /\A\d+\+?\s*(?:d|h|m|days?|hours?|months?)\b/i,
      /\A(?:new|promoted|actively hiring)\b/i
    )
    # A line that is entirely a bracketed URL — Glassdoor's logo/avatar/icon and
    # brand-view tracking-pixel images. Dropped unless it carries a job link.
    IMAGE_OR_PIXEL = %r{\A\[https?://[^\]]*\]\z}i
    # Zero-width / bidi filler characters Gmail/Glassdoor pad the body with.
    FILLER = /[͏​-‏  ‪-‮﻿]/

    # Non-breaking / fixed-width spaces Glassdoor uses between fields (e.g.
    # the company↔rating gap). Normalized to a plain space so \s-based
    # patterns (COMPANY_RATING, SALARY, META) match. U+00A0/2007/2009/202F.
    NBSP = /[    ]/

    # The legacy "Company — Location" pair on a single line (em/en dash/hyphen).
    COMPANY_LOCATION = /\A(?<company>.+?)\s+[—–-]\s+(?<location>.+)\z/

    # Company-insights variant detection: the subject suffix, or the line that
    # opens its job list (the research sections above it are never parsed).
    INSIGHTS_SUBJECT = /:\s*What You Need to Know\s*\z/i
    INSIGHTS_MARKER = /\ACheck out these jobs\z/i
    # A bare rating line ("3.7 ★") — the company is on its own line above.
    BARE_RATING = /\A\d(?:\.\d+)?\s*★\z/u

    def self.source_name
      "glassdoor"
    end

    def self.sender_domains
      %w[glassdoor.com glassdoormail.com].freeze
    end

    def parse
      lines = cleaned_lines
      return parse_company_insights(lines) if company_insights?(lines)

      previous_url_index = -1

      lines.each_index.filter_map do |index|
        url = lines[index][JOB_URL]
        next unless url
        next if url.match?(REDIRECT)

        block = block_for(lines, index, previous_url_index)
        previous_url_index = index
        next if block.nil?

        build(block, url)
      end
    end

    private

    def company_insights?(lines)
      subject.strip.match?(INSIGHTS_SUBJECT) || lines.any? { |l| l.match?(INSIGHTS_MARKER) }
    end

    # Company-insights path: read only the job list after the marker. Each
    # block ends at a whole-line bracketed job link; the logo line (which also
    # carries the job link) belongs to the block rather than closing it.
    def parse_company_insights(lines)
      marker = lines.index { |l| l.match?(INSIGHTS_MARKER) }
      return [] if marker.nil?

      block = []
      lines[(marker + 1)..].filter_map do |line|
        url = line[JOB_URL]
        unless url && line.match?(IMAGE_OR_PIXEL) && !url.match?(REDIRECT)
          block << line
          next
        end

        fields = insights_block(block)
        block = []
        build(fields, url) if fields
      end
    end

    # Company line / logo+link line / optional bare rating / title /
    # "Company - Location" / META. Company and location come from the
    # "Company - Location" line, cross-checked against the company line above
    # the logo so a hyphenated company name is never split.
    def insights_block(block)
      logo_index = block.rindex { |l| l[JOB_URL] }
      return nil if logo_index.nil?

      header = logo_index.positive? ? block[logo_index - 1] : nil
      rest = block[(logo_index + 1)..].reject { |l| l.match?(BARE_RATING) || l.match?(META) }
      salary_index = rest.index { |l| l.match?(SALARY) }
      salary = salary_index && rest.delete_at(salary_index)
      title, company_location = rest
      return nil if title.blank?

      company, location = split_company_location(company_location, header)
      return nil if company.blank?

      { company: company, title: title, location: location, salary: salary }
    end

    def split_company_location(line, header)
      if line && header.present?
        prefix = /\A#{Regexp.escape(header)}\s+[—–-]\s+/
        return [ header, line.sub(prefix, "") ] if line.match?(prefix)
      end

      match = line&.match(COMPANY_LOCATION)
      return [ match[:company], match[:location] ] if match

      [ header, nil ]
    end

    # Lines with whitespace stripped, filler removed, and empty / image / avatar
    # lines dropped — but block order preserved. Bracketed-URL image and
    # tracking-pixel lines are dropped unless the line itself carries a job link.
    def cleaned_lines
      body.split("\n").filter_map do |raw|
        line = raw.sub(/\A>\s?/, "").gsub(FILLER, "").gsub(NBSP, " ").strip
        next if line.empty? || line == "avatar" || line.start_with?("[image:")
        next if line.match?(IMAGE_OR_PIXEL) && !line[JOB_URL]

        line
      end
    end

    # Assemble one posting from the lines preceding the link, bounded by the
    # previous block's link so blocks never bleed together. RATED blocks anchor
    # on the "Company <rating> ★" line; UNRATED/legacy blocks are read
    # positionally from the trailing content lines.
    def block_for(lines, url_index, previous_url_index)
      fields = lines[(previous_url_index + 1)...url_index].reject { |l| l[JOB_URL] }
      return nil if fields.empty?

      rating_index = fields.rindex { |l| l.match?(COMPANY_RATING) }
      return rated_block(fields, rating_index) if rating_index

      unrated_block(fields)
    end

    # "Company <rating> ★" / title / location / salary layout — read forward
    # from the rating line, so any email preamble before it is ignored.
    def rated_block(fields, rating_index)
      company = fields[rating_index][COMPANY_RATING, 1]
      rest = fields[(rating_index + 1)..]
      return nil if company.blank? || rest.empty?

      title = rest.shift
      salary = rest.find { |l| l.match?(SALARY) }
      location = rest.find { |l| !l.match?(SALARY) && !l.match?(META) }
      { company: company, title: title, location: location, salary: salary }
    end

    # No rating line: pull out the salary, drop apply-flag/age META, then read
    # the block positionally from the LAST content lines (so the email preamble
    # ahead of the first posting cannot leak into it). Falls back to the legacy
    # "title / Company — Location" two-line layout when no third (location) line
    # and no salary are present.
    def unrated_block(fields)
      core = fields.reject { |l| l.match?(META) }
      salary_index = core.index { |l| l.match?(SALARY) }
      salary = salary_index && core.delete_at(salary_index)
      return nil if core.empty?

      if salary.nil? && core.size == 2 && core.last.match?(COMPANY_LOCATION)
        return legacy_block(core)
      end

      core = core.last(3)
      title = core[1]
      return nil if title.blank?

      { company: core[0], title: title, location: core[2], salary: salary }
    end

    # Legacy "title / Company — Location" layout (the two lines before the link).
    def legacy_block(fields)
      title = fields[-2]
      company_location = fields[-1].match(COMPANY_LOCATION)
      company = company_location ? company_location[:company] : fields[-1]
      location = company_location ? company_location[:location] : nil
      { company: company, title: title, location: location, salary: nil }
    end

    def build(block, url)
      id = url[LISTING_ID, 1]
      posting(
        title: block[:title],
        company: block[:company],
        location: block[:location],
        compensation: block[:salary],
        posting_url: canonical_url(url, id),
        source_url: url
      )
    end

    # A stable, token-free canonical listing URL for dedup and manual apply,
    # built from the listing id when present; otherwise the matched link.
    def canonical_url(url, id)
      return url if id.blank?

      host = url[%r{https?://([\w.-]+)}i, 1] || "www.glassdoor.com"
      "https://#{host}/job-listing/index.htm?jl=#{id}"
    end

    # Prefer the plain-text body; fall back to a tag-stripped HTML body.
    def body
      return text unless text.strip.empty?

      ActionView::Base.full_sanitizer.sanitize(html).to_s
    end
  end
end
