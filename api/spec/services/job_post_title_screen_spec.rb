require "rails_helper"

RSpec.describe JobPostTitleScreen do
  {
    "Senior Software Engineer" => "software_engineering",
    "Full-Stack Developer" => "software_engineering",
    "iOS Engineer" => "software_engineering",
    "Python Engineer, New Grad" => "software_engineering",
    "Lead .NET Engineer" => "software_engineering",
    "C++ Engineer" => "software_engineering",
    "Software Dev Engineer" => "software_engineering",
    "Embedded Systems and DSP Engineer" => "software_engineering",
    "Forward Deployed Engineer" => "software_engineering",
    "Senior RPA Automation Engineer" => "software_engineering",
    "Founding Engineer" => "software_engineering",
    "Applied AI Engineer" => "ai_engineering",
    "LLM Platform Engineer" => "ai_engineering",
    "Agentic AI Developer" => "ai_engineering",
    "Specialist, AI Engineering" => "ai_engineering",
    "Data Scientist / ML Engineer" => "ai_engineering",
    "Machine Vision Engineer" => "ai_engineering",
    "MLOps Engineer" => "ai_engineering",
    "Site Reliability Engineer" => "platform_operations",
    "Cloud Engineer" => "platform_operations",
    "Staff Data Engineer" => "data_engineering",
    "Software Engineering Intern" => "software_engineering",
    "Software Engineering Co-op" => "software_engineering",
    "Software Engineering Lead" => "software_engineering",
    "Engineer II, Software" => "software_engineering",
    "Platform Engineering Lead" => "platform_operations",
    "Software Engineer, Marketing Platform" => "software_engineering",
    "Data Engineer - Sales Analytics" => "data_engineering",
    "Software Developer - Pharmacy Systems" => "software_engineering",
    "CAD Software Developer" => "software_engineering",
    "Software Engineer - Technician Scheduling" => "software_engineering",
    "AI Engineer, Marketing Automation" => "ai_engineering",
    "Cloud Engineer, CAD Platform" => "platform_operations",
    "Senior Developer" => "software_engineering",
    "Salesforce Developer" => "software_engineering",
    "Frontend Engineering Intern" => "software_engineering"
  }.each do |title, family|
    it "accepts #{title.inspect} as #{family}" do
      result = described_class.call(title)

      expect(result).to be_accepted
      expect(result.family).to eq(family)
    end
  end

  [
    "Data Scientist",
    "Analytics Engineer",
    "Developer Relations Manager",
    "Software Engineering Manager",
    "AI Trainer",
    "Solutions Engineer",
    "Mechanical Engineer",
    "Product Manager",
    "Account Executive",
    "AI Engineer Jobs in Canada",
    "Real Estate Developer",
    "Business Developer",
    "Marketing Developer",
    "DevOps Manager",
    "Cloud Engineering Manager",
    "SRE Manager",
    "Site Reliability Director",
    "Infrastructure Manager",
    "Director of Cloud Infrastructure",
    "Marketing Coordinator",
    "Sales Associate",
    "Pharmacy Technician",
    "CAD Technician",
    "Front End Associate"
  ].each do |title|
    it "rejects #{title.inspect}" do
      expect(described_class.call(title)).to be_rejected
    end
  end

  it "does not accept a broad technical title without a software target phrase" do
    result = described_class.call("Staff Engineer")

    expect(result).to be_rejected
    expect(result.reason).to eq("title_missing_target_role")
  end
end
