import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { graphRequest, MetaApiError } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

/** Límite de adjuntos de la Cloud API. */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

type MediaMeta = {
  url?: string;
  mime_type?: string;
  file_size?: number;
};

/**
 * Descarga de un adjunto de Meta para un cerebro externo.
 * GET /api/bot/media/{mediaId} → binario + content-type.
 *
 * El token de WhatsApp NO sale del CRM: el bot pide aquí, jamás a Meta.
 * Flujo Graph: GET {mediaId} → url efímera → GET url con Bearer.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ mediaId: string }> }
) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    return apiError(409, "no_connection", "WhatsApp no está conectado");
  }

  const { mediaId } = await ctx.params;
  if (!/^[\w.-]{1,64}$/.test(mediaId)) {
    return apiError(422, "invalid", "mediaId inválido");
  }

  let meta: MediaMeta;
  try {
    meta = await graphRequest<MediaMeta>(mediaId, { token: creds.token });
  } catch (err) {
    const status = err instanceof MetaApiError && err.status === 404 ? 404 : 502;
    return apiError(
      status,
      "media_meta_failed",
      "Meta no entregó la metadata del adjunto"
    );
  }
  if (!meta.url) {
    return apiError(502, "media_meta_failed", "Meta no entregó URL del adjunto");
  }
  if (meta.file_size && meta.file_size > MAX_MEDIA_BYTES) {
    return apiError(413, "too_large", "El adjunto excede el límite de 16 MB");
  }

  let res: Response;
  try {
    res = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${creds.token}` },
    });
  } catch {
    return apiError(
      502,
      "media_download_failed",
      "No se pudo descargar el adjunto"
    );
  }
  if (!res.ok) {
    return apiError(
      502,
      "media_download_failed",
      `La descarga devolvió ${res.status}`
    );
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_MEDIA_BYTES) {
    return apiError(413, "too_large", "El adjunto excede el límite de 16 MB");
  }
  return new Response(buf, {
    headers: {
      "content-type":
        meta.mime_type ??
        res.headers.get("content-type") ??
        "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}
