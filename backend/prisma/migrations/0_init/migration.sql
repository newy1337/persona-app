-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "dashboard_users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_encrypted" TEXT,
    "region_code" TEXT,
    "role" TEXT NOT NULL DEFAULT 'manager',
    "last_login" INTEGER,
    "created_at" INTEGER NOT NULL,
    "voicer_id" INTEGER,

    CONSTRAINT "dashboard_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_accounts" (
    "user_id" INTEGER NOT NULL,
    "tg_account_id" INTEGER NOT NULL,

    CONSTRAINT "manager_accounts_pkey" PRIMARY KEY ("user_id","tg_account_id")
);

-- CreateTable
CREATE TABLE "dashboard_audit_log" (
    "id" SERIAL NOT NULL,
    "ts" INTEGER NOT NULL,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "payload_json" TEXT,
    "result" TEXT NOT NULL DEFAULT 'success',
    "error" TEXT,

    CONSTRAINT "dashboard_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personas" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "persona" TEXT NOT NULL DEFAULT '{}',
    "goals" TEXT NOT NULL DEFAULT '{}',
    "storylines" TEXT NOT NULL DEFAULT '{}',
    "day_config" TEXT NOT NULL DEFAULT '{}',
    "beats" TEXT,
    "prompts" TEXT NOT NULL DEFAULT '{}',
    "rhythm" TEXT NOT NULL DEFAULT '{}',
    "variables" TEXT NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL,

    CONSTRAINT "personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_versions" (
    "id" SERIAL NOT NULL,
    "persona_id" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "saved_by" TEXT,
    "note" TEXT,
    "created_at" INTEGER NOT NULL,

    CONSTRAINT "persona_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_accounts" (
    "id" SERIAL NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "persona_id" TEXT NOT NULL,
    "session_encrypted" TEXT,
    "proxy_config_encrypted" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unauthorized',
    "added_at" INTEGER NOT NULL,
    "last_login_at" INTEGER,
    "last_heartbeat_at" INTEGER,
    "banned_at" INTEGER,
    "ban_reason" TEXT,
    "meta_json" TEXT,
    "needs_proxy_setup" INTEGER NOT NULL DEFAULT 0,
    "routing_weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "daily_msg_quota" INTEGER,
    "purpose" TEXT NOT NULL DEFAULT 'prod',
    "telegram_user_id" BIGINT,
    "username" TEXT,
    "display_name" TEXT,
    "flood_until" INTEGER,
    "flood_reason" TEXT,

    CONSTRAINT "tg_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "chat_id" BIGINT NOT NULL,
    "account_id" INTEGER,
    "pause_state" TEXT NOT NULL DEFAULT 'active',
    "pause_reason" TEXT,
    "pause_actor" TEXT,
    "paused_until" INTEGER,
    "paused_ts" INTEGER,
    "created_at" INTEGER NOT NULL DEFAULT 0,
    "read_outbox_max_id" INTEGER,
    "read_inbox_max_id" INTEGER,
    "client_status" TEXT,
    "client_status_at" INTEGER,
    "client_status_seen_at" INTEGER,
    "blocked_by_client_at" INTEGER,
    "manager_seen_ts" INTEGER,
    "cleared_by_client_at" INTEGER,
    "note" TEXT,
    "note_by" TEXT,
    "note_at" INTEGER,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("chat_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "ts" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'llm',
    "source_message_id" INTEGER,
    "source_modality" TEXT NOT NULL DEFAULT 'text',
    "tg_msg_id" INTEGER,
    "media_kind" TEXT,
    "file_path" TEXT,
    "reply_to" INTEGER,
    "reaction" TEXT,
    "deleted_at" INTEGER,
    "edited_at" INTEGER,
    "processed_at" INTEGER,
    "inbound_payload" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pinned_facts" (
    "chat_id" BIGINT NOT NULL,
    "facts" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "pinned_facts_pkey" PRIMARY KEY ("chat_id")
);

-- CreateTable
CREATE TABLE "brain_state" (
    "chat_id" BIGINT NOT NULL,
    "state_json" TEXT NOT NULL,
    "updated_at" INTEGER NOT NULL,

    CONSTRAINT "brain_state_pkey" PRIMARY KEY ("chat_id")
);

-- CreateTable
CREATE TABLE "reply_schedule" (
    "delivery" TEXT,
    "chat_id" BIGINT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "due_at" INTEGER NOT NULL,
    "base_due_at" INTEGER NOT NULL DEFAULT 0,
    "opened_at" INTEGER,
    "reason" TEXT NOT NULL,
    "turns" TEXT NOT NULL DEFAULT '[]',
    "created_at" INTEGER NOT NULL,

    CONSTRAINT "reply_schedule_pkey" PRIMARY KEY ("chat_id")
);

-- CreateTable
CREATE TABLE "pending_replies" (
    "id" SERIAL NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "account_id" INTEGER,
    "claimed_at" INTEGER,
    "retry_at" INTEGER,
    "delivery" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "kind" TEXT NOT NULL DEFAULT 'text',
    "file_path" TEXT,
    "reply_to" INTEGER,
    "created_ts" INTEGER NOT NULL,
    "sent_ts" INTEGER,
    "error" TEXT,

    CONSTRAINT "pending_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_admin_actions" (
    "id" SERIAL NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "account_id" INTEGER,
    "action" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_ts" INTEGER NOT NULL,
    "processed_ts" INTEGER,
    "error" TEXT,

    CONSTRAINT "pending_admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beat_delivery" (
    "persona_id" TEXT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "beat" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'delivered',
    "turn" INTEGER,
    "ts" DOUBLE PRECISION NOT NULL,
    "by" TEXT NOT NULL,
    "src" TEXT NOT NULL,
    "actor" TEXT,
    "evidence" TEXT NOT NULL DEFAULT '',
    "rubric_sha" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "beat_delivery_pkey" PRIMARY KEY ("persona_id","chat_id","beat")
);

-- CreateTable
CREATE TABLE "lead_handoff" (
    "persona_id" TEXT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "state" TEXT NOT NULL,
    "hold_armed_at" INTEGER,
    "phone" TEXT,
    "analyst_assigned_at" INTEGER,
    "contact_delivered_at" INTEGER,
    "closed_at" INTEGER,
    "abort_reason" TEXT,
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL,

    CONSTRAINT "lead_handoff_pkey" PRIMARY KEY ("persona_id","chat_id")
);

-- CreateTable
CREATE TABLE "funnel_events" (
    "id" SERIAL NOT NULL,
    "persona_id" TEXT NOT NULL,
    "chat_id" BIGINT,
    "event_type" TEXT NOT NULL,
    "event_meta" TEXT,
    "ts" INTEGER NOT NULL,

    CONSTRAINT "funnel_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_shown" (
    "chat_id" BIGINT NOT NULL,
    "path" TEXT NOT NULL,
    "shown_ts" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'photo',

    CONSTRAINT "media_shown_pkey" PRIMARY KEY ("chat_id","path")
);

-- CreateTable
CREATE TABLE "inbound_media" (
    "id" SERIAL NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "msg_ts" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "saved_at" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "inbound_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_numbers" (
    "id" SERIAL NOT NULL,
    "phone_e164" TEXT,
    "username_key" TEXT,
    "first_name" TEXT,
    "city" TEXT,
    "age" INTEGER,
    "site" TEXT,
    "gender" TEXT,
    "telegram_user_id" BIGINT,
    "telegram_username" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'manual',
    "inserted_at" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assigned_account_id" INTEGER,
    "preferred_account_id" INTEGER,
    "assigned_at" INTEGER,
    "first_contact_at" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" INTEGER,
    "last_error" TEXT,
    "notes" TEXT,
    "avoid_account_id" INTEGER,
    "persona_id" TEXT,
    "owner_user_id" INTEGER,

    CONSTRAINT "phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "initiative_enabled" INTEGER NOT NULL DEFAULT 1,
    "proactive_max_per_day" INTEGER NOT NULL DEFAULT 1,
    "quiet_start" TEXT NOT NULL DEFAULT '23:00',
    "quiet_end" TEXT NOT NULL DEFAULT '08:00',
    "custom_prompt" TEXT NOT NULL DEFAULT '',
    "updated_at" INTEGER NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_usage" (
    "id" SERIAL NOT NULL,
    "created_at" INTEGER NOT NULL,
    "chat_id" BIGINT,
    "persona_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cached_tokens" INTEGER,
    "cache_write_tokens" INTEGER,
    "cache_write_1h_tokens" INTEGER,
    "provider_estimated_cost_usd" DOUBLE PRECISION,
    "elapsed_ms" INTEGER,

    CONSTRAINT "model_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '{}',
    "updated_at" INTEGER NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "voicer_profiles" (
    "user_id" INTEGER NOT NULL,
    "telegram_id" BIGINT,
    "telegram_username" TEXT,
    "link_hash" TEXT,
    "link_expires_at" INTEGER,

    CONSTRAINT "voicer_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "voice_tasks" (
    "source" TEXT NOT NULL DEFAULT 'manager',
    "auto_key" TEXT,
    "auto_reply_id" TEXT,
    "auto_context_id" INTEGER,
    "auto_context_hash" TEXT,
    "auto_expires_at" INTEGER,
    "auto_persona_updated_at" INTEGER,
    "id" SERIAL NOT NULL,
    "manager_id" INTEGER,
    "voicer_id" INTEGER,
    "manager_name" TEXT NOT NULL,
    "voicer_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "voice_mode" TEXT NOT NULL DEFAULT 'library',
    "send_account_id" INTEGER,
    "send_requested_by_id" INTEGER,
    "title" TEXT NOT NULL,
    "script" TEXT NOT NULL DEFAULT '',
    "emotion" TEXT NOT NULL DEFAULT '',
    "tempo" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "contact_label" TEXT NOT NULL,
    "contact_ref" TEXT NOT NULL DEFAULT '',
    "chat_id" BIGINT,
    "chat_grant_account_id" INTEGER,
    "chat_granted_by_id" INTEGER,
    "persona_slug" TEXT NOT NULL,
    "persona_name" TEXT NOT NULL,
    "biography" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "feedback" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL DEFAULT '',
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL,
    "due_at" INTEGER,
    "notify_version" INTEGER NOT NULL DEFAULT 1,
    "notified_version" INTEGER NOT NULL DEFAULT 0,
    "notify_after" INTEGER NOT NULL DEFAULT 0,
    "notify_error" TEXT,
    "bot_message_id" INTEGER,
    "bot_chat_id" BIGINT,

    CONSTRAINT "voice_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_recordings" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "created_at" INTEGER NOT NULL,
    "telegram_message_id" INTEGER NOT NULL,
    "telegram_chat_id" BIGINT NOT NULL,

    CONSTRAINT "voice_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_notices" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "event_key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL,
    "read_at" INTEGER,

    CONSTRAINT "voice_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_deliveries" (
    "notified_status" TEXT NOT NULL DEFAULT '',
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "recording_id" INTEGER NOT NULL,
    "request_key" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "requested_by_id" INTEGER NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "persona_slug" TEXT NOT NULL,
    "history_text" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL,
    "pending_reply_id" INTEGER,

    CONSTRAINT "voice_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voicer_bot_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "next_update_id" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "voicer_bot_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_calls" (
    "id" TEXT NOT NULL,
    "task_id" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "voicer_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connecting',
    "reason" TEXT NOT NULL DEFAULT '',
    "created_at" INTEGER NOT NULL,
    "connected_at" INTEGER,
    "ended_at" INTEGER,
    "finalized_at" INTEGER,
    "resume_status" TEXT NOT NULL DEFAULT 'pending',
    "followup_status" TEXT NOT NULL DEFAULT 'none',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "voice_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_users_username_key" ON "dashboard_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "manager_accounts_tg_account_id_key" ON "manager_accounts"("tg_account_id");

-- CreateIndex
CREATE INDEX "idx_manager_accounts_user" ON "manager_accounts"("user_id");

-- CreateIndex
CREATE INDEX "idx_dashboard_audit_ts" ON "dashboard_audit_log"("ts");

-- CreateIndex
CREATE UNIQUE INDEX "personas_slug_key" ON "personas"("slug");

-- CreateIndex
CREATE INDEX "idx_persona_versions" ON "persona_versions"("persona_id", "section", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tg_accounts_phone_e164_key" ON "tg_accounts"("phone_e164");

-- CreateIndex
CREATE INDEX "idx_tg_persona_status" ON "tg_accounts"("persona_id", "status");

-- CreateIndex
CREATE INDEX "idx_contacts_account" ON "contacts"("account_id");

-- CreateIndex
CREATE INDEX "idx_messages_chat" ON "messages"("chat_id", "id");

-- CreateIndex
CREATE INDEX "idx_messages_chat_ts" ON "messages"("chat_id", "ts", "id");

-- CreateIndex
CREATE INDEX "idx_messages_unprocessed" ON "messages"("processed_at", "role");

-- CreateIndex
CREATE UNIQUE INDEX "uq_messages_chat_source_message" ON "messages"("chat_id", "source_message_id");

-- CreateIndex
CREATE INDEX "idx_reply_schedule_due" ON "reply_schedule"("due_at");

-- CreateIndex
CREATE INDEX "idx_pending_replies_status" ON "pending_replies"("chat_id", "status");

-- CreateIndex
CREATE INDEX "idx_pending_replies_retry" ON "pending_replies"("status", "retry_at");

-- CreateIndex
CREATE INDEX "idx_admin_actions_status" ON "pending_admin_actions"("chat_id", "status");

-- CreateIndex
CREATE INDEX "idx_beat_delivery_chat" ON "beat_delivery"("chat_id");

-- CreateIndex
CREATE INDEX "idx_lead_handoff_state" ON "lead_handoff"("persona_id", "state");

-- CreateIndex
CREATE INDEX "idx_funnel_persona_ts" ON "funnel_events"("persona_id", "ts" DESC);

-- CreateIndex
CREATE INDEX "idx_funnel_chat_ts" ON "funnel_events"("chat_id", "ts" DESC);

-- CreateIndex
CREATE INDEX "idx_inbound_media_chat" ON "inbound_media"("chat_id", "msg_ts");

-- CreateIndex
CREATE UNIQUE INDEX "phone_numbers_phone_e164_key" ON "phone_numbers"("phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "phone_numbers_username_key_key" ON "phone_numbers"("username_key");

-- CreateIndex
CREATE INDEX "idx_phone_telegram_user" ON "phone_numbers"("telegram_user_id");

-- CreateIndex
CREATE INDEX "idx_phone_owner" ON "phone_numbers"("owner_user_id");

-- CreateIndex
CREATE INDEX "idx_phone_status_next" ON "phone_numbers"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "idx_phone_account_contact" ON "phone_numbers"("assigned_account_id", "first_contact_at");

-- CreateIndex
CREATE INDEX "idx_model_usage_created" ON "model_usage"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "voicer_profiles_telegram_id_key" ON "voicer_profiles"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "voicer_profiles_link_hash_key" ON "voicer_profiles"("link_hash");

-- CreateIndex
CREATE UNIQUE INDEX "voice_tasks_auto_key_key" ON "voice_tasks"("auto_key");

-- CreateIndex
CREATE INDEX "voice_tasks_manager_id_status_id_idx" ON "voice_tasks"("manager_id", "status", "id");

-- CreateIndex
CREATE INDEX "voice_tasks_voicer_id_status_priority_id_idx" ON "voice_tasks"("voicer_id", "status", "priority", "id");

-- CreateIndex
CREATE INDEX "voice_tasks_source_status_auto_expires_at_idx" ON "voice_tasks"("source", "status", "auto_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "voice_recordings_task_id_revision_key" ON "voice_recordings"("task_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "voice_recordings_telegram_chat_id_telegram_message_id_key" ON "voice_recordings"("telegram_chat_id", "telegram_message_id");

-- CreateIndex
CREATE INDEX "voice_notices_user_id_read_at_id_idx" ON "voice_notices"("user_id", "read_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_notices_user_id_event_key_key" ON "voice_notices"("user_id", "event_key");

-- CreateIndex
CREATE UNIQUE INDEX "voice_deliveries_request_key_key" ON "voice_deliveries"("request_key");

-- CreateIndex
CREATE UNIQUE INDEX "voice_deliveries_pending_reply_id_key" ON "voice_deliveries"("pending_reply_id");

-- CreateIndex
CREATE INDEX "voice_deliveries_task_id_id_idx" ON "voice_deliveries"("task_id", "id");

-- CreateIndex
CREATE INDEX "voice_calls_task_id_created_at_idx" ON "voice_calls"("task_id", "created_at");

-- AddForeignKey
ALTER TABLE "dashboard_users" ADD CONSTRAINT "dashboard_users_voicer_id_fkey" FOREIGN KEY ("voicer_id") REFERENCES "dashboard_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_accounts" ADD CONSTRAINT "manager_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dashboard_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_accounts" ADD CONSTRAINT "manager_accounts_tg_account_id_fkey" FOREIGN KEY ("tg_account_id") REFERENCES "tg_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_audit_log" ADD CONSTRAINT "dashboard_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dashboard_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tg_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voicer_profiles" ADD CONSTRAINT "voicer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dashboard_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_tasks" ADD CONSTRAINT "voice_tasks_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "dashboard_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_tasks" ADD CONSTRAINT "voice_tasks_voicer_id_fkey" FOREIGN KEY ("voicer_id") REFERENCES "dashboard_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_recordings" ADD CONSTRAINT "voice_recordings_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "voice_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_notices" ADD CONSTRAINT "voice_notices_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "voice_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_deliveries" ADD CONSTRAINT "voice_deliveries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "voice_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_deliveries" ADD CONSTRAINT "voice_deliveries_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "voice_recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_deliveries" ADD CONSTRAINT "voice_deliveries_pending_reply_id_fkey" FOREIGN KEY ("pending_reply_id") REFERENCES "pending_replies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "voice_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Один войсер — одно задание в работе. Партиальный уникальный индекс схемой
-- Prisma не выражается, поэтому живёт здесь.
CREATE UNIQUE INDEX "voice_tasks_one_in_progress" ON "voice_tasks" ("voicer_id") WHERE "status" = 'in_progress';
