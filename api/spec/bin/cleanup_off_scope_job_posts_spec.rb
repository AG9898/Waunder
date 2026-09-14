require "rails_helper"
require "open3"
require "tmpdir"

RSpec.describe "bin/cleanup-off-scope-job-posts" do
  def link(target, link_path)
    FileUtils.mkdir_p(File.dirname(link_path))
    File.symlink(target, link_path) unless File.exist?(link_path)
  end

  def link_spec(spec, base_dir)
    link(spec.full_gem_path, File.join(base_dir, "gems", spec.full_name))
    link(spec.loaded_from, File.join(base_dir, "specifications", "#{spec.full_name}.gemspec"))
    return if spec.extensions.empty? || !File.directory?(spec.extension_dir)

    relative = Pathname(spec.extension_dir).relative_path_from(Pathname(spec.base_dir))
    link(spec.extension_dir, File.join(base_dir, relative))
  end

  def container_gem_env(root)
    gem_home = File.join(root, "gem_home")
    bundle_path = File.join(root, "bundle")
    bundle_gems = File.join(bundle_path, RUBY_ENGINE, RbConfig::CONFIG["ruby_version"])

    Bundler.load.specs.each do |spec|
      next if spec.default_gem?

      link_spec(spec, spec.name == "bundler" ? gem_home : bundle_gems)
    end

    {
      "GEM_HOME" => gem_home,
      "GEM_PATH" => gem_home,
      "BUNDLE_PATH" => bundle_path,
      "BUNDLE_GEMFILE" => Rails.root.join("Gemfile").to_s,
      "RAILS_ENV" => "test"
    }
  end

  it "boots through Bundler before loading pinned default gems and emits a dry-run report" do
    stdout, stderr, status = Dir.mktmpdir do |root|
      env = container_gem_env(root)

      Bundler.with_unbundled_env do
        Open3.capture3(
          env,
          Rails.root.join("bin/cleanup-off-scope-job-posts").to_s,
          "--dry-run",
          "--sample-limit",
          "0"
        )
      end
    end

    expect(status).to be_success, stderr
    expect(JSON.parse(stdout)).to include(
      "dry_run" => true,
      "policy" => JobPostTitleScreen::POLICY_VERSION,
      "removed" => 0
    )
  end
end
