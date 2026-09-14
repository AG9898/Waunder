require "rails_helper"
require "open3"

RSpec.describe "bin/cleanup-off-scope-job-posts" do
  it "boots through Bundler and emits a dry-run report" do
    stdout, stderr, status = Open3.capture3(
      { "RAILS_ENV" => "test" },
      Rails.root.join("bin/cleanup-off-scope-job-posts").to_s,
      "--dry-run",
      "--sample-limit",
      "0"
    )

    expect(status).to be_success, stderr
    expect(JSON.parse(stdout)).to include(
      "dry_run" => true,
      "policy" => JobPostTitleScreen::POLICY_VERSION,
      "removed" => 0
    )
  end
end
