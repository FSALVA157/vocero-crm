-- 010 Canal de Instagram: canal en contacto/conversación, índice único con
-- canal y credenciales de Instagram. Editada a mano sobre la generada:
-- RE-EJECUTABLE (Constitución IV) y aditiva — una columna con default y una
-- tabla vacía son inertes para una instancia que solo usa WhatsApp.
CREATE TABLE IF NOT EXISTS "instagram_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"token_kind" text NOT NULL,
	"ig_user_id" text NOT NULL,
	"username" text,
	"display_name" text,
	"profile_picture_url" text,
	"token_cipher" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_tag" text NOT NULL,
	"token_expires_at" timestamp,
	"app_secret_cipher" text,
	"app_secret_iv" text,
	"app_secret_tag" text,
	"zernio_account_id" text,
	"zernio_webhook_id" text,
	"zernio_webhook_secret_cipher" text,
	"zernio_webhook_secret_iv" text,
	"zernio_webhook_secret_tag" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"subscribed_at" timestamp,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "channel" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "channel_handle" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "channel" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "channel_thread_ref" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instagram_credentials" ADD CONSTRAINT "instagram_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "instagram_credentials_org_uq" ON "instagram_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "instagram_credentials_ig_user_uq" ON "instagram_credentials" USING btree ("ig_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instagram_credentials_zernio_account_idx" ON "instagram_credentials" USING btree ("zernio_account_id");--> statement-breakpoint
-- El índice nuevo se crea ANTES de soltar el viejo: si algo falla a mitad,
-- la unicidad nunca queda sin vigilar.
CREATE UNIQUE INDEX IF NOT EXISTS "contact_org_channel_identity_uq" ON "contact" USING btree ("organization_id","channel","wa_identity");--> statement-breakpoint
DROP INDEX IF EXISTS "contact_org_wa_identity_uq";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_org_channel_idx" ON "conversation" USING btree ("organization_id","channel");
