module InboundEmailParsers
  # Parses LinkedIn job-alert emails.
  #
  # Real LinkedIn "job alert digest" emails repeat, for each posting, a block of
  # three meaningful lines in the plain-text body:
  #
  #   Senior Geo Data Scientist                       <- title
  #   <https://www.linkedin.com/comm/jobs/view/4388176608/...>  <- tracking link
  #   VRIFY · Canada (Remote)                         <- "Company · Location"
  #
  # (older/simple alerts put the URL *after* the "Company · Location" line). The
  # "Company · Location" line — a `·`-separated pair — is the stable anchor: the
  # title is the nearest preceding text line, and the job id comes from the
  # nearest `/jobs/view/<id>` link (which may sit just before or just after the
  # pair). Image-alt lines, tracking filler, and promo blocks are ignored. This
  # is deterministic — no network and no LLM.
  class LinkedIn < Base
    # Matches both the clean (`/jobs/view/<id>`) and tracked
    # (`/comm/jobs/view/<id>`) link shapes LinkedIn uses.
    JOB_URL = %r{/jobs/view/(\d+)}
    # A "Company · Location" line: text, a spaced middle dot, then text.
    COMPANY_LOCATION = /\A(.+?) (?:·|‧|•) (.+)\z/
    # Filler character LinkedIn pads preview whitespace with.
    FILLER = "͏".freeze
    # How far from the "Company · Location" line to look for the job id.
    ID_WINDOW = 4

    def self.source_name
      "linkedin"
    end

    def self.sender_domains
      %w[linkedin.com e.linkedin.com].freeze
    end

    def parse
      tokens = tokenize
      seen = Set.new

      tokens.each_index.filter_map do |index|
        kind, value = tokens[index]
        next unless kind == :pair

        company, location = value
        title = nearest_title(tokens, index)
        id = nearest_id(tokens, index)
        next if title.blank? || company.blank? || id.blank? || seen.include?(id)

        seen << id
        posting(
          title: title,
          company: company,
          location: location,
          posting_url: canonical_url(id),
          source_url: canonical_url(id)
        )
      end
    end

    private

    # Reduce the body to an ordered list of meaningful tokens:
    #   [:pair, [company, location]]  — a "Company · Location" line
    #   [:id, "<digits>"]             — a job-view link
    #   [:text, "<line>"]             — any other content line (title candidate)
    # Image-alt lines, filler, and non-job URLs are dropped.
    def tokenize
      body.split("\n").filter_map do |raw|
        line = raw.strip
        next if line.empty? || line.include?(FILLER)

        if line.start_with?("http", "<http")
          match = line.match(JOB_URL)
          next [ :id, match[1] ] if match

          next # non-job URL (search/feed/promo) — ignore
        end

        next if line.start_with?("[image:")

        if (pair = line.match(COMPANY_LOCATION))
          [ :pair, [ pair[1].strip, pair[2].strip ] ]
        else
          [ :text, line ]
        end
      end
    end

    # The title is the nearest preceding plain-text line (skipping other
    # "Company · Location" pairs and ids).
    def nearest_title(tokens, index)
      (index - 1).downto(0) do |i|
        return tokens[i][1] if tokens[i][0] == :text
      end
      nil
    end

    # The job id is the nearest job-view link, searching outward (the link sits
    # right before the pair in digest emails, right after it in simple ones).
    def nearest_id(tokens, index)
      (1..ID_WINDOW).each do |offset|
        before = tokens[index - offset] if index - offset >= 0
        return before[1] if before&.first == :id

        after = tokens[index + offset]
        return after[1] if after&.first == :id
      end
      nil
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
