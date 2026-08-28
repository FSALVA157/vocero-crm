import { describe, expect, it } from "vitest";
import { envelopeFor, NOTIFY_MAX_BYTES } from "@/server/events/bus";
import { rolePlan } from "@/server/startup/background";

/**
 * 006 — piezas puras de la cola/bus: qué hace cada ROLE y cómo viaja un
 * evento por NOTIFY (entero, por referencia, o solo local).
 */

describe("rolePlan (006)", () => {
  it("all: sirve, consume y recibe eventos (default: cero cambio operativo)", () => {
    expect(rolePlan("all")).toEqual({ consume: true, bridge: true, serveApp: true });
  });
  it("web: sirve y recibe eventos, NO consume (hay un worker aparte)", () => {
    expect(rolePlan("web")).toEqual({ consume: false, bridge: true, serveApp: true });
  });
  it("worker: solo consume; publica pero no necesita recibir", () => {
    expect(rolePlan("worker")).toEqual({ consume: true, bridge: false, serveApp: false });
  });
});

describe("envelopeFor (006)", () => {
  const origin = "p1";
  it("un evento pequeño viaja entero con su origen y organización", () => {
    const raw = envelopeFor(origin, "org_a", {
      type: "conversation.updated",
      data: { conversation: { id: "cv_1" } },
    });
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.origin).toBe("p1");
    expect(parsed.org).toBe("org_a");
    expect(parsed.event.type).toBe("conversation.updated");
    expect(Buffer.byteLength(raw!, "utf8")).toBeLessThanOrEqual(NOTIFY_MAX_BYTES);
  });

  it("un message.new que no cabe en NOTIFY viaja por referencia (id del mensaje)", () => {
    const raw = envelopeFor(origin, "org_a", {
      type: "message.new",
      data: {
        conversationId: "cv_1",
        message: { id: "msg_grande", text: "ñ".repeat(NOTIFY_MAX_BYTES) },
      },
    });
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.event).toBeUndefined();
    expect(parsed.ref).toEqual({ kind: "message", conversationId: "cv_1", messageId: "msg_grande" });
    expect(Buffer.byteLength(raw!, "utf8")).toBeLessThanOrEqual(NOTIFY_MAX_BYTES);
  });

  it("un evento grande sin forma de rehidratar se queda solo local (null)", () => {
    const raw = envelopeFor(origin, "org_a", {
      type: "conversation.updated",
      data: { conversation: { id: "cv_1", notes: "x".repeat(NOTIFY_MAX_BYTES) } },
    });
    expect(raw).toBeNull();
  });
});
