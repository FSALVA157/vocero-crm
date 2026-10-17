import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { explainKapsoError, listPhoneNumbers } from "@/server/whatsapp/kapso";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ apiKey: z.string().trim().min(1) });

/**
 * 011 — Números del proyecto de Kapso de una API key, para elegir en el alta.
 * NO persiste la key. POST y no GET: la key jamás va en la URL (ni en logs).
 */
export const POST = withAuth(async (_session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    const numbers = await listPhoneNumbers(body.data.apiKey);
    return Response.json({ numbers });
  } catch (err) {
    const e = explainKapsoError(err);
    return apiError(e.status, e.code, e.message);
  }
}, { permission: "settings.whatsapp.write" });
