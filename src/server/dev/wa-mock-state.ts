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

type WaMockState = {
  outbox: OutboxEntry[];
  templates: MockTemplate[];
  counter: number;
  /** Sello de los ids emitidos; rota con cada reset (ver nextOutboundWamid). */
  seal: string;
};

const globalForMock = globalThis as unknown as { __waMockState?: WaMockState };

const newSeal = () => Math.random().toString(36).slice(2, 8);

export function getWaMockState(): WaMockState {
  if (!globalForMock.__waMockState) {
    globalForMock.__waMockState = { outbox: [], templates: [], counter: 0, seal: newSeal() };
  }
  return globalForMock.__waMockState;
}

export function resetWaMockState(): void {
  // El sello ROTA con el contador: si el contador vuelve a 0 y el sello no,
  // la segunda corrida del self-test en el mismo proceso re-emite los mismos
  // ids que la primera y el UNIQUE de wa_message_id la tumba con un 500.
  globalForMock.__waMockState = { outbox: [], templates: [], counter: 0, seal: newSeal() };
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
