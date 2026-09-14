# Deterministic, title-only policy for deciding whether a bulk-inbound posting
# belongs in Waunder's software-and-AI target pool. This runs before a JobPost
# is materialized, so rejected alert entries do not create companies, routes,
# URL identities, scoring jobs, or feed rows.
class JobPostTitleScreen
  POLICY_VERSION = "software_ai_core_v1".freeze

  Result = Struct.new(:accepted, :family, :reason, keyword_init: true) do
    def accepted? = accepted
    def rejected? = !accepted
  end

  # Exclusions win even when another target phrase appears. These are common
  # alert false positives whose work is not primarily software development.
  EXCLUDED_PATTERNS = [
    /\b(?:developer relations|developer advocate|developer advocacy|developer evangelist)\b/i,
    /\bjobs in\b/i,
    /\b(?:engineering|software|development|platform|data|ai|ml)\s+(?:manager|director|team lead)\b/i,
    /\b(?:manager|director|head|vice president|vp)\b.*\b(?:engineering|software|development|platform|data|ai|ml)\b/i,
    /\b(?:product|project|program|delivery)\s+manager\b/i,
    /\b(?:solutions?|sales|pre[\s-]?sales|customer success|customer support|technical support|field service)\s+engineer\b/i,
    /\b(?:data analyst|business analyst|business intelligence|analytics engineer)\b/i,
    /\b(?:ai|ml)\s+(?:trainer|annotator|evaluator|rater)\b/i,
    /\b(?:recruiter|recruiting|talent acquisition|account executive|marketing|sales)\b/i,
    /\b(?:mechanical|civil|electrical|chemical|manufacturing|process)\s+engineer\b/i,
    /\b(?:nurse|pharmacist|pharmacy|technician|cad)\b/i
  ].freeze

  FAMILY_PATTERNS = {
    "ai_engineering" => [
      /\b(?:ai|ml|llm)\b.*\b(?:engineer|developer|architect)\b/i,
      /\b(?:engineer|developer|architect)\b.*\b(?:ai|ml|llm)\b/i,
      /\b(?:artificial intelligence|machine learning|deep learning|generative ai|applied ai)\b.*\b(?:engineer|developer|architect)\b/i,
      /\b(?:engineer|developer|architect)\b.*\b(?:artificial intelligence|machine learning|deep learning|generative ai|applied ai)\b/i,
      /\b(?:agentic|ai[\s-]?agent)\b.*\b(?:engineer|developer|architect)\b/i,
      /\b(?:engineer|developer|architect)\b.*\b(?:agentic|ai[\s-]?agent)\b/i,
      /\b(?:ai|ml)\s+engineering\b/i,
      /\bmachine vision engineer\b/i,
      /\bmlops\b/i
    ],
    "software_engineering" => [
      /\bsoftware\s+(?:development\s+)?(?:engineer|developer|architect)\b/i,
      /\bsoftware\s+dev(?:elopment)?\s+engineer\b/i,
      /\bsoftware development\b/i,
      /\bdeveloper\b/i,
      /\b(?:front[\s-]?end|back[\s-]?end|full[\s-]?stack)\b/i,
      /\b(?:web|mobile|ios|android|application|product)\s+(?:software\s+)?(?:engineer|developer)\b/i,
      /\b(?:embedded|firmware)\b.*\b(?:engineer|developer)\b/i,
      /(?:\b(?:python|java|ruby|go|golang|rust|scala|kotlin|swift|node(?:\.js)?|react|typescript|javascript)\b|\.net\b|\bc\+\+(?=\s)|\bc#(?=\s))\s+(?:software\s+)?(?:engineer|developer)\b/i,
      /\b(?:application security|appsec)\s+engineer\b/i,
      /\b(?:sdet|software development engineer in test|test automation engineer|qa automation engineer)\b/i,
      /\b(?:forward deployed|rpa automation)\s+engineer\b/i,
      /\b(?:member of technical staff|founding engineer)\b/i
    ],
    "platform_operations" => [
      /\bplatform\s+engineer\b/i,
      /\binfrastructure\s+engineer\b/i,
      /\bcloud\s+(?:engineer|developer)\b/i,
      /\bdevops\b/i,
      /\bsite reliability(?: engineer)?\b/i,
      /\bsre\b/i
    ],
    "data_engineering" => [
      /\bdata\s+(?:platform\s+)?engineer\b/i,
      /\b(?:etl|data pipeline)\s+(?:engineer|developer)\b/i
    ]
  }.freeze

  def self.call(title)
    new(title).call
  end

  def initialize(title)
    @title = title.to_s.strip
  end

  def call
    return rejected("title_blank") if title.blank?
    return rejected("title_matches_exclusion") if EXCLUDED_PATTERNS.any? { |pattern| title.match?(pattern) }

    family = FAMILY_PATTERNS.find do |_name, patterns|
      patterns.any? { |pattern| title.match?(pattern) }
    end&.first

    return rejected("title_missing_target_role") unless family

    Result.new(accepted: true, family: family, reason: "title_matches_#{family}")
  end

  private

  attr_reader :title

  def rejected(reason)
    Result.new(accepted: false, family: nil, reason: reason)
  end
end
