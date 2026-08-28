-- 005 Multi-organización: secretos POR ORGANIZACIÓN.
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitución IV) y
-- estrictamente ADITIVA: todo nullable, sin renames ni drops, de modo que un
-- rollback de solo código siga funcionando contra la base ya migrada.
-- Los valores no se rellenan aquí: cifrar y hashear exigen ENCRYPTION_KEY y la
-- implementación de la app, así que lo hace adoptLegacyEnvSecrets() al arrancar.

CREATE TABLE IF NOT EXISTS "org_ai_config" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"token_cipher" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_tag" text NOT NULL,
	"token_last4" text NOT NULL,
	"model" text NOT NULL,
	"judge_model" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "app_secret_cipher" text;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "app_secret_iv" text;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "app_secret_tag" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "webhook_token" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "bot_key_hash" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "bot_key_last4" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "bot_key_created_at" timestamp;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "org_ai_config" ADD CONSTRAINT "org_ai_config_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "org_ai_config_org_uq" ON "org_ai_config" USING btree ("organization_id");--> statement-breakpoint

-- Una persona puede estar en varias organizaciones, pero una sola vez en cada
-- una. Si alguna instancia tuviera duplicados previos, el índice fallaría: se
-- limpian antes conservando la membresía más antigua.
DELETE FROM "member" a USING "member" b
WHERE a."organization_id" = b."organization_id"
  AND a."user_id" = b."user_id"
  AND (a."created_at" > b."created_at" OR (a."created_at" = b."created_at" AND a."id" > b."id"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "member_org_user_uq" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint

-- UNIQUE de webhook_token y bot_key_hash como índices parciales: NULL no
-- colisiona en Postgres, pero el índice parcial deja la intención explícita.
CREATE UNIQUE INDEX IF NOT EXISTS "organization_webhook_token_uq" ON "organization" USING btree ("webhook_token") WHERE "webhook_token" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_bot_key_hash_uq" ON "organization" USING btree ("bot_key_hash") WHERE "bot_key_hash" IS NOT NULL;
