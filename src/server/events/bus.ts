import { EventEmitter } from "node:events";
import { getSql } from "@/lib/db";

/**
 * Bus de eventos por organización (contrato sse.md). Publicar SIEMPRE después
 * del commit de BD.
 *
 * 006: entrega local inmediata (EventEmitter) + NOTIFY en el canal
 * `vocero_events` para que los DEMÁS procesos (otra réplica, el worker) lo
 * reemitan a sus suscriptores SSE. Cada proceso ignora sus propias
 * notificaciones por `origin`. Sigue sin colas externas: es Postgres.
 *
 * NOTIFY admite 8000 bytes: un evento más grande viaja como referencia y el
 * receptor lo rehidrata desde la BD (server/events/rehydrate.ts).
 */

export type SseEvent =
  | { type: "message.new"; data: { conversationId: string; message: unknown } }
  | {
      type: "message.status";
      data: {
        conversationId: string;
        messageId: string;
        status: string;
        /** Motivo del fallo, presente solo cuando status = "failed". */
        error?: string | null;
      };
    }
  | { type: "conversation.updated"; data: { conversation: unknown } }
  | {
      type: "lab.run";
      data: {
        runId: string;
        status: string;
        progress: { done: number; total: number };
        score?: number | null;
      };
    };

export const EVENTS_CHANNEL = "vocero_events";
/** Margen bajo el límite de 8000 bytes de NOTIFY. */
export const NOTIFY_MAX_BYTES = 7000;

type Envelope =
  | { origin: string; org: string; event: SseEvent }
  | { origin: string; org: string; ref: { kind: "message"; conversationId: string; messageId: string } };

type BusState = {
  emitter: EventEmitter;
  processId: string;
  bridgeStarted: boolean;
};

const globalForBus = globalThis as unknown as { __voceroBus?: BusState };

function state(): BusState {
  if (!globalForBus.__voceroBus) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(200);
    globalForBus.__voceroBus = {
      emitter,
      processId: `${process.pid}:${Math.random().toString(36).slice(2, 10)}`,
      bridgeStarted: false,
    };
  }
  return globalForBus.__voceroBus;
}

export function processId(): string {
  return state().processId;
}

function emitLocal(organizationId: string, event: SseEvent): void {
  state().emitter.emit(`org:${organizationId}`, event);
}

/**
 * Decide cómo viaja un evento por NOTIFY: entero si cabe, por referencia si
 * es un `message.new` grande, o nada (solo local) si no hay forma de
 * rehidratarlo. Pura, para poder probarla.
 */
export function envelopeFor(
  origin: string,
  organizationId: string,
  event: SseEvent
): string | null {
  const full = JSON.stringify({ origin, org: organizationId, event } satisfies Envelope);
  if (Buffer.byteLength(full, "utf8") <= NOTIFY_MAX_BYTES) return full;
  if (event.type === "message.new") {
    const msg = event.data.message as { id?: unknown } | null;
    if (msg && typeof msg.id === "string") {
      return JSON.stringify({
        origin,
        org: organizationId,
        ref: { kind: "message", conversationId: event.data.conversationId, messageId: msg.id },
      } satisfies Envelope);
    }
  }
  return null;
}

export function publish(organizationId: string, event: SseEvent): void {
  emitLocal(organizationId, event);
  const payload = envelopeFor(processId(), organizationId, event);
  if (!payload) {
    console.warn(`[bus] evento ${event.type} demasiado grande para NOTIFY; solo entrega local`);
    return;
  }
  getSql()
    .notify(EVENTS_CHANNEL, payload)
    .catch((err: unknown) => console.error("[bus] NOTIFY falló:", err));
}

export function subscribe(
  organizationId: string,
  listener: (event: SseEvent) => void
): () => void {
  const { emitter } = state();
  const channel = `org:${organizationId}`;
  emitter.on(channel, listener);
  return () => emitter.off(channel, listener);
}

/**
 * LISTEN al canal y reemisión local de lo que publican otros procesos.
 * postgres.js reconecta sola si la conexión dedicada se cae; mientras tanto
 * el cliente SSE tiene el catch-up por `since=` del contrato. Idempotente.
 */
export function startEventBridge(): void {
  const st = state();
  if (st.bridgeStarted) return;
  st.bridgeStarted = true;
  getSql()
    .listen(
      EVENTS_CHANNEL,
      (raw) => {
        void handleNotification(raw);
      },
      () => console.log(`[bus] escuchando ${EVENTS_CHANNEL} (proceso ${st.processId})`)
    )
    .catch((err: unknown) => {
      st.bridgeStarted = false;
      console.error("[bus] LISTEN falló; los eventos de otros procesos no llegarán:", err);
    });
}

async function handleNotification(raw: string): Promise<void> {
  let env: Envelope;
  try {
    env = JSON.parse(raw) as Envelope;
  } catch {
    return;
  }
  if (env.origin === processId()) return;
  if ("event" in env) {
    emitLocal(env.org, env.event);
    return;
  }
  try {
    const { rehydrateMessageEvent } = await import("@/server/events/rehydrate");
    const event = await rehydrateMessageEvent(env.ref.conversationId, env.ref.messageId);
    if (event) emitLocal(env.org, event);
  } catch (err) {
    console.error("[bus] no se pudo rehidratar un evento por referencia:", err);
  }
}
