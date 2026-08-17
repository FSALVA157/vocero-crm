/**
 * Qué versión está corriendo.
 *
 * Existe para responder una pregunta que hoy no tiene respuesta desde la app:
 * "¿ya se desplegó mi cambio?". Sin esto hay que ir al servidor a comparar
 * commits, y en la práctica nadie lo hace — se asume que sí, y se depura
 * durante media hora un bug que ya estaba arreglado en un build que nunca
 * llegó.
 *
 * Los dos valores se congelan al CONSTRUIR (ver `next.config.ts`): el binario
 * lleva dentro de qué código salió, así que no pueden mentir en tiempo de
 * ejecución.
 */

/** SemVer de `package.json`. Cambia cuando alguien publica, no en cada push. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

/**
 * Commit del que salió el build, corto. Vacío si quien construyó no lo pasó
 * (`--build-arg SOURCE_COMMIT=...`); Coolify lo inyecta solo.
 *
 * Es el que de verdad zanja la duda: dos despliegues seguidos de `main` sin
 * tocar la versión se ven idénticos por SemVer y distintos por commit.
 */
export const BUILD_COMMIT = (process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "").slice(0, 7);

/** `v1.1.0 · 8e62d0b`, o solo `v1.1.0` si no hubo commit al construir. */
export function versionLabel(): string {
  return BUILD_COMMIT ? `v${APP_VERSION} · ${BUILD_COMMIT}` : `v${APP_VERSION}`;
}
