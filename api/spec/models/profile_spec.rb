require "rails_helper"

RSpec.describe Profile, type: :model do
  it "requires a full name" do
    profile = described_class.new(full_name: "")

    expect(profile).not_to be_valid
    expect(profile.errors[:full_name]).to include("can't be blank")
  end

  it "validates jsonb shape for structured fields" do
    profile = described_class.new(full_name: "Ada Lovelace", work_history: {}, education: "x", skills: nil)

    expect(profile).not_to be_valid
    expect(profile.errors[:work_history]).to include("must be an array")
    expect(profile.errors[:education]).to include("must be an array")
    expect(profile.errors[:skills]).to include("must be an array")
  end

  it "stores ciphertext for sensitive fields while accessors return plaintext" do
    profile = described_class.create!(
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+1-555-0100",
      street_address: "1 Analytical Engine Way"
    )

    raw = ActiveRecord::Base.connection.select_one(
      "SELECT email, phone, street_address FROM profiles WHERE id = #{profile.id}"
    )

    expect(raw["email"]).not_to include("ada@example.com")
    expect(raw["phone"]).not_to include("555-0100")
    expect(raw["street_address"]).not_to include("Analytical Engine")

    reloaded = described_class.find(profile.id)
    expect(reloaded.email).to eq("ada@example.com")
    expect(reloaded.phone).to eq("+1-555-0100")
    expect(reloaded.street_address).to eq("1 Analytical Engine Way")
  end

  it "encrypts email deterministically so it remains queryable" do
    described_class.create!(full_name: "Ada Lovelace", email: "Ada@Example.com")

    found = described_class.find_by(email: "ada@example.com")

    expect(found).to be_present
    expect(found.email).to eq("ada@example.com")
  end
end
