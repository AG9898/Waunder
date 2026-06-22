# Deterministic dispatcher that turns a persisted InboundEmail into normalized
# JobPost records using known-sender parsers.
#
# It prefers deterministic parsing: the From address selects a known-sender
# parser, which extracts postings purely from the email body (no network
# calls). When no known-sender parser matches — or a matched parser extracts
# nothing — the raw content is left persisted on the InboundEmail and flagged
# for LLM fallback (consumed by LLM scoring). Inbound content is never silently
# dropped.
class InboundEmailParser
  PARSERS = [
    InboundEmailParsers::LinkedIn,
    InboundEmailParsers::Indeed,
    InboundEmailParsers::Glassdoor
  ].freeze

  Result = Struct.new(:job_posts, :parser, :fallback, keyword_init: true) do
    def fallback? = fallback
  end

  def initialize(inbound_email)
    @inbound_email = inbound_email
  end

  def call
    parser_class = select_parser
    postings = parser_class ? parser_class.new(email_content).parse : []

    if postings.empty?
      flag_for_llm_fallback!(matched_parser: parser_class)
      return Result.new(job_posts: [], parser: parser_class, fallback: true)
    end

    job_posts = persist(postings)
    mark_parsed!(parser_class)
    Result.new(job_posts: job_posts, parser: parser_class, fallback: false)
  end

  private

  attr_reader :inbound_email

  # Matches a parser against the envelope From first, then any sender found in a
  # forwarded header inside the body. A LinkedIn/Indeed/Glassdoor alert that the
  # owner forwards (or that Gmail auto-forwards) arrives with the forwarder's
  # address as the envelope From, but the original sender survives as a
  # "From: ... <addr@domain>" line in the quoted body — so deterministic parsing
  # still applies when the layout matches.
  def select_parser
    candidate_from_addresses.each do |address|
      parser = PARSERS.find { |parser| parser.matches?(address) }
      return parser if parser
    end
    nil
  end

  FORWARDED_FROM = /^\s*From:\s*[^<\n]*<?\s*([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i

  def candidate_from_addresses
    addresses = [ from_address ]
    "#{data['text']}\n#{data['html']}".scan(FORWARDED_FROM).each { |match| addresses << match[0] }
    addresses.compact_blank.uniq
  end

  def persist(postings)
    postings.filter_map { |posting| JobPostMaterializer.new(posting).call }
  end

  def mark_parsed!(parser_class)
    update_parse_result(
      "status" => "parsed",
      "parser" => parser_class.source_name,
      "needs_llm_fallback" => false
    )
  end

  def flag_for_llm_fallback!(matched_parser:)
    update_parse_result(
      "status" => matched_parser ? "matched_no_postings" : "unknown_sender",
      "parser" => matched_parser&.source_name,
      "needs_llm_fallback" => true
    )
    Rails.logger.info(
      "Inbound email flagged for LLM fallback inbound_email_id=#{inbound_email.id} " \
        "parser=#{matched_parser&.source_name || 'none'}"
    )
  end

  # Persist the parse outcome onto the already-stored raw_payload jsonb so the
  # raw content is retained and the LLM-fallback flag is discoverable without a
  # schema change.
  def update_parse_result(parse_result)
    payload = inbound_email.raw_payload.deep_dup
    payload["parse_result"] = parse_result
    inbound_email.update!(raw_payload: payload)
  end

  def email_content
    {
      from: from_address,
      subject: data["subject"],
      text: data["text"],
      html: data["html"]
    }
  end

  def from_address
    data["from"].to_s
  end

  def data
    inbound_email.raw_payload.fetch("data", {})
  end
end
