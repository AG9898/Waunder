module InboundEmailParsers
  # Parses Glassdoor job-alert emails.
  #
  # Glassdoor alerts repeat a posting block of the form:
  #
  #   Product Manager
  #   Initech — Remote, US
  #   https://www.glassdoor.com/job-listing/product-manager-initech-JV_IC123_KO0,15.htm
  #
  # The "job-listing" URL is the deterministic anchor; the two lines preceding
  # it carry the title and the "Company — Location" pair.
  class Glassdoor < Base
    JOB_URL = %r{https?://(?:www\.)?glassdoor\.com/(?:job-listing|partner/jobListing)[^\s)>"']*}i
    COMPANY_LOCATION = /\A(?<company>.+?)\s+[—–-]\s+(?<location>.+)\z/

    def self.source_name
      "glassdoor"
    end

    def self.sender_domains
      %w[glassdoor.com glassdoormail.com].freeze
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
          posting_url: match[0],
          source_url: match[0]
        )
      end
    end

    private

    def split_company_location(line)
      fields = line.to_s.match(COMPANY_LOCATION)
      return [ line.presence, nil ] unless fields

      [ fields[:company], fields[:location] ]
    end
  end
end
