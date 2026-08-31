-- 007 App ID de la app de Meta por organización (suscripción del webhook a
-- nivel app). Editada a mano sobre la generada: RE-EJECUTABLE (Constitución IV)
-- y aditiva. El valor es público; el App Secret sigue cifrado en app_secret_*.
ALTER TABLE "meta_credentials" ADD COLUMN IF NOT EXISTS "app_id" text;
