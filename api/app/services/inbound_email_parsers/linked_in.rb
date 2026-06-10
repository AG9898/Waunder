module InboundEmailParsers
  # Parses LinkedIn job-alert emails.
  #
  # LinkedIn alerts repeat a posting block of the form:
  #
  #   Senior Backend Engineer
  #   Acme Corp · San Francisco, CA (Remote)
  #   https://www.linkedin.com/jobs/view/3812345678/
  #
  # The job-view URL is the deterministic anchor; the two lines preceding it
  # carry the title and the "Company · Location" pair.
  class LinkedIn < Base
    JOB_URL = %r{https?://(?:www\.)?linkedin\.com/jobs/view/(\d+)[^\s)>"']*}i

    def self.source_name
      "linkedin"
    end

    def self.sender_domains
      %w[linkedin.com e.linkedin.com].freeze
    end

    def parse
      lines = text.split("\n").map(&:strip)

      lines.each_with_index.filter_map do |line, index|
        match = line.match(JOB_URL)
        next unless match

        title = lines[index - 2]
        company, location = split_company_location(lines[index - 1])
        next if title.blank? || company.blank?

        posting(
          title: title,
          company: company,
          location: location,
          posting_url: canonical_url(match),
          source_url: match[0]
        )
      end
    end

    private

    def canonical_url(match)
      "https://www.linkedin.com/jobs/view/#{match[1]}/"
    end

    def split_company_location(line)
      return [ nil, nil ] if line.blank?

      company, location = line.split("·", 2).map(&:strip)
      [ company, location ]
    end
  end
end
