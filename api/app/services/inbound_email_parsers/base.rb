module InboundEmailParsers
  # Base class for deterministic known-sender job-alert parsers.
  #
  # A parser is matched by sender (`matches?`) and turns the email's text/html
  # body into a list of normalized posting hashes (`parse`). It performs no
  # network calls — extraction is purely string/regex based over the persisted
  # email content.
  class Base
    # Normalized posting fields produced by every parser.
    POSTING_KEYS = %i[title company location source_url posting_url].freeze

    def self.source_name
      raise NotImplementedError, "#{name} must define .source_name"
    end

    # Domains in the From address that this parser handles.
    def self.sender_domains
      raise NotImplementedError, "#{name} must define .sender_domains"
    end

    def self.matches?(from_address)
      domain = from_address.to_s.downcase[/@([^>\s]+)/, 1]
      return false if domain.blank?

      sender_domains.any? { |known| domain == known || domain.end_with?(".#{known}") }
    end

    def initialize(email_content)
      @content = email_content
    end

    # Returns an Array of normalized posting Hashes (may be empty).
    def parse
      raise NotImplementedError, "#{self.class.name} must implement #parse"
    end

    private

    attr_reader :content

    def text
      content[:text].to_s
    end

    def html
      content[:html].to_s
    end

    def subject
      content[:subject].to_s
    end

    # Build a normalized posting hash, dropping blank values so callers can
    # validate required fields explicitly.
    def posting(title:, company:, posting_url:, location: nil, source_url: nil)
      {
        title: title&.strip.presence,
        company: company&.strip.presence,
        location: location&.strip.presence,
        posting_url: posting_url&.strip.presence,
        source_url: (source_url || posting_url)&.strip.presence,
        source: self.class.source_name
      }
    end
  end
end
