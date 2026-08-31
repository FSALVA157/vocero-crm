import { graphRequest, MetaApiError } from "@/lib/meta/client";

export type ConnectionCheck =
  | {
      ok: true;
      displayPhoneNumber: string;
      verifiedName: string | null;
    }
  | { ok: false; code: "invalid_token" | "meta_unavailable" | "meta_error"; message: string };

/**
 * Valida token↔número contra la Graph API SIN persistir nada (FR-040):
 * un GET del número con el token debe devolver su display_phone_number.
 */
export async function testConnection(
  phoneNumberId: string,
  token: string
): Promise<ConnectionCheck> {
  try {
    const res = await graphRequest<{
      display_phone_number?: string;
      verified_name?: string;
      id: string;
    }>(`${phoneNumberId}?fields=display_phone_number,verified_name`, {
      token,
    });
    if (!res.display_phone_number) {
      return {
        ok: false,
        code: "meta_error",
        message:
          "Meta no devolvió el número: verifica que el Phone Number ID sea correcto",
      };
    }
    return {
      ok: true,
      displayPhoneNumber: res.display_phone_number,
      verifiedName: res.verified_name ?? null,
    };
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        return {
          ok: false,
          code: "invalid_token",
          message:
            "El token no es válido o expiró. Verifica que corresponde a este número (modo directo: token de usuario del sistema; modo agencia: token entregado por tu backend).",
        };
      }
      if (err.status === 0 || err.status >= 500) {
        return {
          ok: false,
          code: "meta_unavailable",
          message: "Meta no está disponible en este momento; intenta de nuevo",
        };
      }
      return { ok: false, code: "meta_error", message: err.message };
    }
    throw err;
  }
}

/**
 * Suscribe la app a la WABA tras guardar.
 *
 * 005 — con `override` manda además el callback de ESTA organización
 * (`override_callback_uri` + `verify_token`, DV-VC-04): así una sola app de
 * Meta puede servir a varias empresas y cada una recibe sus eventos en su
 * propia URL. En modo directo el override es inofensivo y ahorra que el
 * cliente lo configure a mano.
 *
 * Best-effort: si Meta rechaza (token sin permisos de management, URL
 * inalcanzable durante su handshake), la conexión se guarda igual y el motivo
 * vuelve para mostrarlo en el asistente.
 */
export async function subscribeAppToWaba(
  wabaId: string,
  token: string,
  override?: { callbackUrl: string; verifyToken: string }
): Promise<{
  ok: boolean;
  error?: string;
  /** 007: código y status de Meta, para traducir el fallo a una acción. */
  errorCode?: number | null;
  errorStatus?: number;
}> {
  try {
    await graphRequest(`${wabaId}/subscribed_apps`, {
      method: "POST",
      token,
      body: override
        ? {
            override_callback_uri: override.callbackUrl,
            verify_token: override.verifyToken,
          }
        : undefined,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 007: sin culpar al "modo agencia" — el motivo real viaja a la UI.
    console.warn("[connect] POST subscribed_apps rechazado por Meta:", message);
    return {
      ok: false,
      error: message,
      errorCode: err instanceof MetaApiError ? err.code : null,
      errorStatus: err instanceof MetaApiError ? err.status : undefined,
    };
  }
}
