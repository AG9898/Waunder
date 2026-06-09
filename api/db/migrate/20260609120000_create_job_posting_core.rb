class CreateJobPostingCore < ActiveRecord::Migration[8.1]
  ROUTE_TYPES = %w[
    company_careers
    greenhouse
    lever
    ashby
    workday
    linkedin_easy_apply
    indeed_apply
    glassdoor_apply
    unknown
  ].freeze

  def change
    create_table :companies do |t|
      t.string :name, null: false
      t.string :website_url
      t.string :careers_url
      t.string :domain

      t.timestamps
    end

    add_index :companies, :name
    add_index :companies, :domain

    create_table :job_posts do |t|
      t.references :company, null: false, foreign_key: true
      t.string :title, null: false
      t.string :location
      t.string :source
      t.string :source_url
      t.string :posting_url
      t.string :employment_type
      t.string :remote_status
      t.text :description
      t.text :compensation
      t.datetime :posted_at
      t.datetime :expires_at
      t.jsonb :source_payload, null: false, default: {}
      t.string :scoring_status, null: false, default: "pending"
      t.integer :match_score
      t.text :summary
      t.jsonb :relevant_requirements, null: false, default: []
      t.jsonb :missing_requirements, null: false, default: []
      t.text :resume_alignment_notes
      t.text :application_strategy
      t.jsonb :red_flags, null: false, default: []
      t.datetime :scored_at

      t.timestamps
    end

    add_index :job_posts, :source_url
    add_index :job_posts, :posting_url
    add_index :job_posts, :scoring_status
    add_check_constraint :job_posts, "match_score IS NULL OR (match_score >= 0 AND match_score <= 100)",
      name: "job_posts_match_score_range"

    create_table :application_routes do |t|
      t.references :job_post, null: false, foreign_key: true, index: { unique: true }
      t.string :source_url
      t.string :canonical_posting_url
      t.string :application_url
      t.string :route_type, null: false, default: "unknown"
      t.string :recommended_route
      t.decimal :route_confidence, precision: 4, scale: 3

      t.timestamps
    end

    quoted_route_types = ROUTE_TYPES.map { |route_type| quote(route_type) }.join(", ")
    add_check_constraint :application_routes, "route_type IN (#{quoted_route_types})",
      name: "application_routes_route_type_check"
    add_check_constraint :application_routes,
      "route_confidence IS NULL OR (route_confidence >= 0 AND route_confidence <= 1)",
      name: "application_routes_route_confidence_range"
  end
end
