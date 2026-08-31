-- 008 Snapshot de monto/moneda del lead en cada evento de etapa: "cuánto cerré
-- en julio" lee el monto DEL CIERRE, no el actual. Editada a mano sobre la
-- generada: RE-EJECUTABLE (Constitución IV) y aditiva.
ALTER TABLE "lead_stage_event" ADD COLUMN IF NOT EXISTS "amount_cents" integer;
ALTER TABLE "lead_stage_event" ADD COLUMN IF NOT EXISTS "currency" text;
