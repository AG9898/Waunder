require "rails_helper"

RSpec.describe ApplicationDraft, type: :model do
  it "requires an application" do
    draft = described_class.new

    expect(draft).not_to be_valid
    expect(draft.errors[:application]).to include("must exist")
  end

  it "stores structured answers and autofill payload as JSON shapes" do
    draft = described_class.new(structured_answers: {}, autofill_payload: [])

    expect(draft).not_to be_valid
    expect(draft.errors[:structured_answers]).to include("must be an array")
    expect(draft.errors[:autofill_payload]).to include("must be an object")
  end
end
