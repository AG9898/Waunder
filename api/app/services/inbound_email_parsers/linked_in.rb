module InboundEmailParsers
  # Parses LinkedIn job-alert emails.
  #
  # LinkedIn ships more than one plain-text alert template, so the parser
  # supports two block layouts and anchors each posting on its job-view id
  # (`/jobs/view/<id>`) — the one element present in every format.
  #
  # 1. "Company · Location" layout (forwarded alerts / older template): the
  #    company and location share one `·`-separated line, and the job-view link
  #    sits just before or just after it:
  #
  #      Senior Geo Data Scientist                       <- title
  #      <https://www.linkedin.com/comm/jobs/view/4388176608/...>  <- link
  #      VRIFY · Canada (Remote)                         <- "Company · Location"
  #
  # 2. Native digest layout (`email_job_alert_digest_01`, the most common direct
  #    alert): title, company, and location are each on their own line and the
  #    link is prefixed with "View job: ":
  #
  #      AI / ML Engineer            <- title
  #      BPM LLP                     <- company
  #      Canada                      <- location
  #      This company is actively hiring   <- promo (ignored)
  #      View job: https://www.linkedin.com/comm/jobs/view/4309297029/...
  #
  # Image-alt lines, tracking filler, dividers, and promo/boilerplate lines are
  # ignored. Extraction is deterministic — no network and no LLM.
  class LinkedIn < Base
    # Matches both the clean (`/jobs/view/<id>`) and tracked
    # (`/comm/jobs/view/<id>`) link shapes LinkedIn uses, anywhere in a line
    # (covers bare `<http...>` links and `View job: http...` prefixed lines).
    JOB_URL = %r{/jobs/view/(\d+)}
    # A "Company · Location" line: text, a spaced middle dot, then text.
    COMPANY_LOCATION = /\A(.+?) (?:·|‧|•) (.+)\z/
    # Filler character LinkedIn pads preview whitespace with.
    FILLER = "͏".freeze
    # A horizontal rule between digest blocks (a run of dashes/underscores).
    DIVIDER = /\A[-–—_=]{3,}\z/
    # Promo / boilerplate lines that sit between the job fields and the link in
    # the native digest layout, or as the alert header — never a job field.
    PROMO = Regexp.union(
      /\Athis company is actively hiring\z/i,
      /\Aactively recruiting\z/i,
      /\A\d+\s+(?:school alumni|alumni|connections?)\b/i,
      /\Ayour job alert\b/i,
      /\Anew jobs?\b.*match your preferences/i,
      /\Asee all jobs\b/i
    )
    # How far from a "Company · Location" line to look for the job id.
    ID_WINDOW = 4
    # How many lines preceding a native-layout link to read as title/company/location.
    NATIVE_FIELDS = 3

    def self.source_name
      "linkedin"
    end

    def self.sender_domains
      %w[linkedin.com e.linkedin.com].freeze
    end

    def parse
      @tokens = tokenize
      @seen = Set.new
      pair_anchored_postings + native_postings
    end

    private

    # Pass 1 — "Company · Location" layout: anchor on each pair line, take the
    # title from the nearest preceding text line and the id from the nearest
    # job-view link (which may sit just before or just after the pair).
    def pair_anchored_postings
      @tokens.each_index.filter_map do |index|
        kind, value = @tokens[index]
        next unless kind == :pair

        company, location = value
        title = nearest_title(index)
        id = nearest_id(index)
        next if blank_posting?(title, company, id) || @seen.include?(id)

        @seen << id
        build(title:, company:, location:, id:)
      end
    end

    # Pass 2 — native digest layout: anchor on each job-view link not already
    # consumed by pass 1, and read title/company/location from the up-to-three
    # text lines preceding it (bounded by the previous block's link).
    def native_postings
      @tokens.each_index.filter_map do |index|
        next unless @tokens[index][0] == :id

        id = @tokens[index][1]
        next if @seen.include?(id)

        title, company, location = native_fields(index)
        next if blank_posting?(title, company, id)

        @seen << id
        build(title:, company:, location:, id:)
      end
    end

    # Reduce the body to an ordered list of meaningful tokens:
    #   [:pair, [company, location]]  — a "Company · Location" line
    #   [:id, "<digits>"]             — a job-view link (bare or "View job:")
    #   [:text, "<line>"]             — any other content line (job field)
    # Image-alt lines, filler, dividers, promos, and non-job URLs are dropped.
    def tokenize
      body.split("\n").filter_map do |raw|
        line = raw.strip
        next if line.empty? || line.include?(FILLER) || line.match?(DIVIDER)
        next if line.start_with?("[image:")

        if (match = line.match(JOB_URL))
          next [ :id, match[1] ]
        end

        next if line.start_with?("http", "<http") # non-job URL — ignore
        next if line.match?(PROMO)

        pair = line.match(COMPANY_LOCATION)
        if pair && !line.include?("http")
          [ :pair, [ pair[1].strip, pair[2].strip ] ]
        else
          [ :text, line ]
        end
      end
    end

    # The title is the nearest preceding plain-text line (skipping ids and other
    # pair lines).
    def nearest_title(index)
      (index - 1).downto(0) do |i|
        return @tokens[i][1] if @tokens[i][0] == :text
      end
      nil
    end

    # The job id is the nearest job-view link, searching outward (the link sits
    # right before the pair in digest emails, right after it in simple ones).
    def nearest_id(index)
      (1..ID_WINDOW).each do |offset|
        before = @tokens[index - offset] if index - offset >= 0
        return before[1] if before&.first == :id

        after = @tokens[index + offset]
        return after[1] if after&.first == :id
      end
      nil
    end

    # Read the native-layout fields from the text lines preceding a link. Lines
    # are collected nearest-first (location, company, title) and stop at the
    # previous block's link, so blocks never bleed into each other.
    def native_fields(id_index)
      lines = []
      (id_index - 1).downto(0) do |i|
        kind, value = @tokens[i]
        break if kind == :id

        next unless kind == :text

        lines << value
        break if lines.size == NATIVE_FIELDS
      end

      title = lines.last
      rest = lines[0...-1] || []
      company = rest.last
      location = rest.size >= 2 ? rest.first : nil
      [ title, company, location ]
    end

    def build(title:, company:, location:, id:)
      posting(
        title: title,
        company: company,
        location: location,
        posting_url: canonical_url(id),
        source_url: canonical_url(id)
      )
    end

    def blank_posting?(title, company, id)
      title.blank? || company.blank? || id.blank?
    end

    def canonical_url(id)
      "https://www.linkedin.com/jobs/view/#{id}/"
    end

    # Prefer the plain-text body; fall back to a tag-stripped HTML body.
    def body
      return text unless text.strip.empty?

      ActionView::Base.full_sanitizer.sanitize(html).to_s
    end
  end
end
