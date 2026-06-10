module InboundEmailParsers
  # Parses Indeed job-alert emails.
  #
  # Indeed alerts repeat a posting block of the form:
  #
  #   Staff Data Engineer - Globex Inc (Austin, TX)
  #   https://www.indeed.com/viewjob?jk=a1b2c3d4e5f6
  #
  # The "viewjob?jk=" URL is the deterministic anchor; the line preceding it
  # carries "Title - Company (Location)".
  class Indeed < Base
    JOB_URL = %r{https?://(?:www\.)?indeed\.com/viewjob\?jk=([A-Za-z0-9]+)[^\s)>"']*}i
    TITLE_LINE = /\A(?<title>.+?)\s+-\s+(?<company>.+?)(?:\s+\((?<location>.+?)\))?\z/

    def self.source_name
      "indeed"
    end

    def self.sender_domains
      %w[indeed.com indeedemail.com].freeze
    end

    def parse
      lines = text.split("\n").map(&:strip)

      lines.each_with_index.filter_map do |line, index|
        match = line.match(JOB_URL)
        next unless match

        fields = lines[index - 1].to_s.match(TITLE_LINE)
        next unless fields

        posting(
          title: fields[:title],
          company: fields[:company],
          location: fields[:location],
          posting_url: canonical_url(match),
          source_url: match[0]
        )
      end
    end

    private

    def canonical_url(match)
      "https://www.indeed.com/viewjob?jk=#{match[1]}"
    end
  end
end
