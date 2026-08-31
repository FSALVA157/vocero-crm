/**
 * Estado en memoria del harness wa-mock (solo dev/test). Vive en globalThis
 * porque Next recarga módulos en dev; una instancia = un proceso, así que el
 * outbox en memoria es suficiente para las aserciones del self-test.
 */

export type OutboxEntry = {
  n: number;
  phoneNumberId: string;
  to: string;
  type: string;
  body: unknown;
  at: string;
  /**
   * Id que se le devolvió al CRM. Lo expone el outbox para que un self-test
   * pueda mandarle un webhook de estado a ESE mensaje sin adivinar el formato.
   */
  waMessageId?: string;
};

export type MockTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  body: string;
  /** Componentes tal cual los mandó el CRM: Meta valida aquí los `example`. */
  components?: unknown[];
};

/** 007: suscripción a nivel app registrada por POST /{app-id}/subscriptions. */
export type MockAppSubscription = {
  callback_url: string;
  verify_token: string;
  fields: string[];
};

/** 007: fila de GET /{waba}/subscribed_apps. */
export type MockWabaSubscription = {
  whatsapp_business_api_data: { id: string; name: string; link: string };
  override_callback_uri?: string;
};

type WaMockState = {
  outbox: OutboxEntry[];
  templates: MockTemplate[];
  /** 007: por App ID. */
  appSubscriptions: Record<string, MockAppSubscription>;
  /** 007: por WABA ID. */
  wabaSubscriptions: Record<string, MockWabaSubscription[]>;
  counter: number;
  /** Sello de los ids emitidos; rota con cada reset (ver nextOutboundWamid). */
  seal: string;
};

const globalForMock = globalThis as unknown as { __waMockState?: WaMockState };

const newSeal = () => Math.random().toString(36).slice(2, 8);

export function getWaMockState(): WaMockState {
  if (!globalForMock.__waMockState) {
    globalForMock.__waMockState = {
      outbox: [],
      templates: [],
      appSubscriptions: {},
      wabaSubscriptions: {},
      counter: 0,
      seal: newSeal(),
    };
  }
  return globalForMock.__waMockState;
}

export function resetWaMockState(): void {
  // El sello ROTA con el contador: si el contador vuelve a 0 y el sello no,
  // la segunda corrida del self-test en el mismo proceso re-emite los mismos
  // ids que la primera y el UNIQUE de wa_message_id la tumba con un 500.
  globalForMock.__waMockState = {
      outbox: [],
      templates: [],
      appSubscriptions: {},
      wabaSubscriptions: {},
      counter: 0,
      seal: newSeal(),
    };
}

export function nextN(): number {
  return ++getWaMockState().counter;
}

/**
 * Sello único por arranque del proceso. Sin él, el contador del mock reinicia
 * al reiniciar `pnpm dev` y vuelve a emitir `wamid.mock.out.1`, que choca con
 * el UNIQUE de `wa_message_id` en la BD de una corrida anterior (500 al
 * enviar). No es un fallo del producto: la idempotencia hace su trabajo.
 */
export function nextOutboundWamid(): string {
  return `wamid.mock.out.${getWaMockState().seal}.${nextN()}`;
}

/** Los entrantes y echoes simulados también llevan sello, por la misma razón. */
export function nextInboundWamid(): string {
  return `wamid.mock.in.${getWaMockState().seal}.${nextN()}`;
}

export function nextEchoWamid(): string {
  return `wamid.mock.echo.${getWaMockState().seal}.${nextN()}`;
}
