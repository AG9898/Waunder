require "rails_helper"

RSpec.describe ResumeDocument, type: :model do
  let(:profile) { Profile.create!(full_name: "Ada Lovelace") }

  it "requires a profile and title" do
    document = described_class.new(title: "")

    expect(document).not_to be_valid
    expect(document.errors[:profile]).to include("must exist")
    expect(document.errors[:title]).to include("can't be blank")
  end

  it "defaults parsed_structure to an empty hash" do
    document = described_class.new(profile:, title: "Resume v1")

    expect(document.parsed_structure).to eq({})
  end

  it "stores ciphertext for sensitive fields while accessors return plaintext" do
    document = described_class.create!(
      profile:,
      title: "Resume v1",
      raw_text: "Ada Lovelace — Senior Engineer",
      parsed_structure: { "name" => "Ada Lovelace", "years" => 7 }
    )

    raw = ActiveRecord::Base.connection.select_one(
      "SELECT raw_text, parsed_structure FROM resume_documents WHERE id = #{document.id}"
    )

    expect(raw["raw_text"]).not_to include("Ada Lovelace")
    expect(raw["parsed_structure"]).not_to include("Ada Lovelace")

    reloaded = described_class.find(document.id)
    expect(reloaded.raw_text).to eq("Ada Lovelace — Senior Engineer")
    expect(reloaded.parsed_structure).to eq("name" => "Ada Lovelace", "years" => 7)
  end
end
