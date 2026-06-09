# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_06_09_120000) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "application_routes", force: :cascade do |t|
    t.string "application_url"
    t.string "canonical_posting_url"
    t.datetime "created_at", null: false
    t.bigint "job_post_id", null: false
    t.string "recommended_route"
    t.decimal "route_confidence", precision: 4, scale: 3
    t.string "route_type", default: "unknown", null: false
    t.string "source_url"
    t.datetime "updated_at", null: false
    t.index ["job_post_id"], name: "index_application_routes_on_job_post_id", unique: true
    t.check_constraint "route_confidence IS NULL OR route_confidence >= 0::numeric AND route_confidence <= 1::numeric", name: "application_routes_route_confidence_range"
    t.check_constraint "route_type::text = ANY (ARRAY['company_careers'::character varying, 'greenhouse'::character varying, 'lever'::character varying, 'ashby'::character varying, 'workday'::character varying, 'linkedin_easy_apply'::character varying, 'indeed_apply'::character varying, 'glassdoor_apply'::character varying, 'unknown'::character varying]::text[])", name: "application_routes_route_type_check"
  end

  create_table "companies", force: :cascade do |t|
    t.string "careers_url"
    t.datetime "created_at", null: false
    t.string "domain"
    t.string "name", null: false
    t.datetime "updated_at", null: false
    t.string "website_url"
    t.index ["domain"], name: "index_companies_on_domain"
    t.index ["name"], name: "index_companies_on_name"
  end

  create_table "job_posts", force: :cascade do |t|
    t.text "application_strategy"
    t.bigint "company_id", null: false
    t.text "compensation"
    t.datetime "created_at", null: false
    t.text "description"
    t.string "employment_type"
    t.datetime "expires_at"
    t.string "location"
    t.integer "match_score"
    t.jsonb "missing_requirements", default: [], null: false
    t.datetime "posted_at"
    t.string "posting_url"
    t.jsonb "red_flags", default: [], null: false
    t.jsonb "relevant_requirements", default: [], null: false
    t.string "remote_status"
    t.text "resume_alignment_notes"
    t.datetime "scored_at"
    t.string "scoring_status", default: "pending", null: false
    t.string "source"
    t.jsonb "source_payload", default: {}, null: false
    t.string "source_url"
    t.text "summary"
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.index ["company_id"], name: "index_job_posts_on_company_id"
    t.index ["posting_url"], name: "index_job_posts_on_posting_url"
    t.index ["scoring_status"], name: "index_job_posts_on_scoring_status"
    t.index ["source_url"], name: "index_job_posts_on_source_url"
    t.check_constraint "match_score IS NULL OR match_score >= 0 AND match_score <= 100", name: "job_posts_match_score_range"
  end

  add_foreign_key "application_routes", "job_posts"
  add_foreign_key "job_posts", "companies"
end
