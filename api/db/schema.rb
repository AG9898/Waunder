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

ActiveRecord::Schema[8.1].define(version: 2026_07_13_170000) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "active_storage_attachments", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.bigint "record_id", null: false
    t.string "record_type", null: false
    t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
    t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
  end

  create_table "active_storage_blobs", force: :cascade do |t|
    t.bigint "byte_size", null: false
    t.string "checksum"
    t.string "content_type"
    t.datetime "created_at", null: false
    t.string "filename", null: false
    t.string "key", null: false
    t.text "metadata"
    t.string "service_name", null: false
    t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
  end

  create_table "active_storage_variant_records", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.string "variation_digest", null: false
    t.index ["blob_id", "variation_digest"], name: "index_active_storage_variant_records_uniqueness", unique: true
  end

  create_table "application_drafts", force: :cascade do |t|
    t.bigint "application_id", null: false
    t.jsonb "autofill_payload", default: {}, null: false
    t.text "cover_letter"
    t.datetime "created_at", null: false
    t.text "message"
    t.text "resume_emphasis_notes"
    t.jsonb "structured_answers", default: [], null: false
    t.datetime "updated_at", null: false
    t.index ["application_id"], name: "index_application_drafts_on_application_id", unique: true
    t.check_constraint "jsonb_typeof(autofill_payload) = 'object'::text", name: "application_drafts_autofill_payload_json_object"
    t.check_constraint "jsonb_typeof(structured_answers) = 'array'::text", name: "application_drafts_structured_answers_json_array"
  end

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

  create_table "applications", force: :cascade do |t|
    t.datetime "approved_at"
    t.datetime "created_at", null: false
    t.text "failure_reason"
    t.bigint "job_post_id", null: false
    t.datetime "last_status_change_at"
    t.date "next_follow_up_on"
    t.text "pipeline_note"
    t.string "pipeline_stage"
    t.string "pipeline_status", default: "interested", null: false
    t.string "status", default: "draft", null: false
    t.datetime "submitted_at"
    t.datetime "updated_at", null: false
    t.index ["job_post_id"], name: "index_applications_on_job_post_id"
    t.index ["last_status_change_at"], name: "index_applications_on_last_status_change_at"
    t.index ["pipeline_status"], name: "index_applications_on_pipeline_status"
    t.index ["status"], name: "index_applications_on_status"
    t.check_constraint "pipeline_status::text = ANY (ARRAY['interested'::character varying, 'drafting'::character varying, 'applied'::character varying, 'interviewing'::character varying, 'offer'::character varying, 'rejected'::character varying, 'withdrawn'::character varying, 'archived'::character varying, 'needs_review'::character varying]::text[])", name: "applications_pipeline_status_check"
    t.check_constraint "status::text = ANY (ARRAY['draft'::character varying, 'approved'::character varying, 'submitted'::character varying, 'paused'::character varying, 'failed'::character varying]::text[])", name: "applications_status_check"
  end

  create_table "audit_events", force: :cascade do |t|
    t.bigint "application_id", null: false
    t.datetime "created_at", null: false
    t.string "event_type", default: "status_change", null: false
    t.jsonb "logs", default: [], null: false
    t.jsonb "metadata", default: {}, null: false
    t.text "reason"
    t.jsonb "screenshots", default: [], null: false
    t.string "status", null: false
    t.datetime "updated_at", null: false
    t.index ["application_id"], name: "index_audit_events_on_application_id"
    t.index ["event_type"], name: "index_audit_events_on_event_type"
    t.index ["status"], name: "index_audit_events_on_status"
    t.check_constraint "jsonb_typeof(logs) = 'array'::text", name: "audit_events_logs_json_array"
    t.check_constraint "jsonb_typeof(metadata) = 'object'::text", name: "audit_events_metadata_json_object"
    t.check_constraint "jsonb_typeof(screenshots) = 'array'::text", name: "audit_events_screenshots_json_array"
    t.check_constraint "status::text = ANY (ARRAY['draft'::character varying, 'approved'::character varying, 'submitted'::character varying, 'paused'::character varying, 'failed'::character varying]::text[])", name: "audit_events_status_check"
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

  create_table "contact_candidates", force: :cascade do |t|
    t.string "company_name"
    t.datetime "created_at", null: false
    t.bigint "job_post_id", null: false
    t.string "linkedin_url"
    t.string "name", null: false
    t.text "relevance_reason", null: false
    t.string "title"
    t.datetime "updated_at", null: false
    t.index ["job_post_id"], name: "index_contact_candidates_on_job_post_id"
    t.index ["linkedin_url"], name: "index_contact_candidates_on_linkedin_url"
  end

  create_table "inbound_emails", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "event_id", null: false
    t.string "event_type", null: false
    t.string "intake_state", default: "queued", null: false
    t.string "provider", default: "resend", null: false
    t.string "provider_email_id"
    t.jsonb "raw_payload", null: false
    t.datetime "updated_at", null: false
    t.index ["event_type"], name: "index_inbound_emails_on_event_type"
    t.index ["intake_state"], name: "index_inbound_emails_on_intake_state"
    t.index ["provider", "event_id"], name: "index_inbound_emails_on_provider_and_event_id", unique: true
    t.index ["provider_email_id"], name: "index_inbound_emails_on_provider_email_id"
    t.check_constraint "intake_state::text = ANY (ARRAY['queued'::character varying, 'held'::character varying, 'processing'::character varying, 'processed'::character varying, 'failed'::character varying]::text[])", name: "inbound_emails_intake_state_values"
    t.check_constraint "jsonb_typeof(raw_payload) = 'object'::text", name: "inbound_emails_raw_payload_json_object"
  end

  create_table "intake_controls", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.boolean "enabled", default: true, null: false
    t.datetime "last_maintenance_at"
    t.datetime "paused_at"
    t.datetime "resumed_at"
    t.datetime "updated_at", null: false
  end

  create_table "job_post_audit_events", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "event_type", default: "lifecycle_changed", null: false
    t.bigint "job_post_id", null: false
    t.jsonb "metadata", default: {}, null: false
    t.datetime "updated_at", null: false
    t.index ["event_type"], name: "index_job_post_audit_events_on_event_type"
    t.index ["job_post_id"], name: "index_job_post_audit_events_on_job_post_id"
    t.check_constraint "jsonb_typeof(metadata) = 'object'::text", name: "job_post_audit_events_metadata_json_object"
  end

  create_table "job_posts", force: :cascade do |t|
    t.text "application_strategy"
    t.bigint "company_id", null: false
    t.text "compensation"
    t.datetime "created_at", null: false
    t.text "description"
    t.string "employment_type"
    t.datetime "expires_at"
    t.string "lifecycle_state", default: "active", null: false
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
    t.jsonb "triage_reasons", default: [], null: false
    t.integer "triage_score"
    t.string "triage_status", default: "unreviewed", null: false
    t.datetime "triaged_at"
    t.datetime "updated_at", null: false
    t.index ["company_id"], name: "index_job_posts_on_company_id"
    t.index ["lifecycle_state"], name: "index_job_posts_on_lifecycle_state"
    t.index ["posting_url"], name: "index_job_posts_on_posting_url"
    t.index ["scoring_status"], name: "index_job_posts_on_scoring_status"
    t.index ["source_url"], name: "index_job_posts_on_source_url"
    t.index ["triage_status"], name: "index_job_posts_on_triage_status"
    t.check_constraint "lifecycle_state::text = ANY (ARRAY['active'::character varying, 'backlog'::character varying, 'removed'::character varying]::text[])", name: "job_posts_lifecycle_state_values"
    t.check_constraint "match_score IS NULL OR match_score >= 0 AND match_score <= 100", name: "job_posts_match_score_range"
    t.check_constraint "triage_score IS NULL OR triage_score >= 0 AND triage_score <= 100", name: "job_posts_triage_score_range"
  end

  create_table "outreach_drafts", force: :cascade do |t|
    t.bigint "contact_candidate_id", null: false
    t.datetime "created_at", null: false
    t.text "loose_template"
    t.text "message", null: false
    t.datetime "updated_at", null: false
    t.index ["contact_candidate_id"], name: "index_outreach_drafts_on_contact_candidate_id"
  end

  create_table "profiles", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.jsonb "education", default: [], null: false
    t.string "email"
    t.string "full_name"
    t.string "github_url"
    t.string "headline"
    t.string "linkedin_url"
    t.string "location"
    t.string "phone"
    t.string "portfolio_url"
    t.jsonb "skills", default: [], null: false
    t.text "street_address"
    t.text "summary"
    t.datetime "updated_at", null: false
    t.jsonb "work_history", default: [], null: false
    t.check_constraint "jsonb_typeof(education) = 'array'::text", name: "profiles_education_json_array"
    t.check_constraint "jsonb_typeof(skills) = 'array'::text", name: "profiles_skills_json_array"
    t.check_constraint "jsonb_typeof(work_history) = 'array'::text", name: "profiles_work_history_json_array"
  end

  create_table "push_subscriptions", force: :cascade do |t|
    t.text "auth_key", null: false
    t.string "content_encoding", default: "aes128gcm", null: false
    t.datetime "created_at", null: false
    t.string "endpoint", null: false
    t.datetime "expires_at"
    t.text "p256dh_key", null: false
    t.datetime "updated_at", null: false
    t.string "user_agent"
    t.index ["endpoint"], name: "index_push_subscriptions_on_endpoint", unique: true
  end

  create_table "resume_documents", force: :cascade do |t|
    t.string "content_type"
    t.datetime "created_at", null: false
    t.string "filename"
    t.string "parse_status", default: "pending", null: false
    t.datetime "parsed_at"
    t.text "parsed_structure"
    t.boolean "primary", default: false, null: false
    t.bigint "profile_id", null: false
    t.text "raw_text"
    t.string "storage_key"
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.index ["profile_id"], name: "index_resume_documents_on_profile_id"
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
  add_foreign_key "application_drafts", "applications"
  add_foreign_key "application_routes", "job_posts"
  add_foreign_key "applications", "job_posts"
  add_foreign_key "audit_events", "applications"
  add_foreign_key "contact_candidates", "job_posts"
  add_foreign_key "job_post_audit_events", "job_posts"
  add_foreign_key "job_posts", "companies"
  add_foreign_key "outreach_drafts", "contact_candidates"
  add_foreign_key "resume_documents", "profiles"
end
