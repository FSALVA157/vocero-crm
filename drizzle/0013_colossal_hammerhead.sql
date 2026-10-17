ALTER TABLE "meta_credentials" ALTER COLUMN "waba_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'meta' NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "kapso_webhook_id" text;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "kapso_webhook_secret_cipher" text;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "kapso_webhook_secret_iv" text;--> statement-breakpoint
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "kapso_webhook_secret_tag" text;