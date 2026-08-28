-- 006 Cola durable del agente + heartbeat del Laboratorio.
-- Editada a mano sobre la generada: RE-EJECUTABLE (Constitución IV) y aditiva.
-- (drizzle-kit proponía además DROP de dos constraints UNIQUE en organization
-- que nunca existieron: 0008 las creó como índices parciales. Se omiten.)

CREATE TABLE IF NOT EXISTS "agent_job" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"run_after" timestamp DEFAULT now() NOT NULL,
	"requeue" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"locked_at" timestamp,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);--> statement-breakpoint

ALTER TABLE "agent_test_run" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "agent_job" ADD CONSTRAINT "agent_job_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "agent_job" ADD CONSTRAINT "agent_job_conversation_id_conversation_id_fk"
		FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Coalescing: a lo sumo UN job activo por conversación.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_job_conv_active_uq" ON "agent_job" USING btree ("conversation_id") WHERE "agent_job"."status" IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_job_claim_idx" ON "agent_job" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_job_org_idx" ON "agent_job" USING btree ("organization_id","created_at");
