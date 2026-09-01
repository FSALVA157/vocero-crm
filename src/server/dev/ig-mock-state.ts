/**
 * 010 — Estado en memoria del ig-mock (solo dev/test): imita la Instagram API
 * (graph.instagram.com), el OAuth de Business Login y la API de Zernio. Vive
 * en globalThis porque Next recarga módulos en dev.
 */

export type IgOutboxEntry = {
  n: number;
  transport: "meta" | "zernio";
  igUserId: string;
  to: string;
  text: string;
  tag: string | null;
  at: string;
  platformMessageId: string;
};

export type IgMockProfile = {
  igUserId: string;
  username: string;
  name: string;
};

type ZernioWebhook = { id: string; url: string; secret: string; events: string[] };

type IgMockState = {
  outbox: IgOutboxEntry[];
  /** IG_ID → campos suscritos. */
  subscriptions: Record<string, string[]>;
  /** tokens emitidos por el OAuth simulado: token → perfil. */
  tokens: Record<string, IgMockProfile>;
  /** Zernio: API key → cuentas conectadas. */
  zernioAccounts: Record<string, { id: string; platform: string; username: string; name: string; platformId: string | null }[]>;
  zernioWebhooks: Record<string, ZernioWebhook[]>;
  /** Tokens/keys revocados a propósito por el self-test (simulan caducidad). */
  revoked: string[];
  /** OAuth simulado: code → token corto (en globalThis: next dev no conserva módulos). */
  oauthCodes: Record<string, string>;
  counter: number;
  seal: string;
};

const g = globalThis as unknown as { __igMockState?: IgMockState };
const newSeal = () => Math.random().toString(36).slice(2, 8);

/** Perfil por defecto del negocio de prueba (token `ig-tok-e2e`). */
export const DEFAULT_BUSINESS: IgMockProfile = {
  igUserId: "1789000000001",
  username: "vocero_demo",
  name: "Vocero Demo",
};

function fresh(): IgMockState {
  return {
    outbox: [],
    subscriptions: {},
    tokens: { "ig-tok-e2e": DEFAULT_BUSINESS },
    zernioAccounts: {
      "sk_e2e_zernio_key_0000": [
        {
          id: "zacc_e2e_1",
          platform: "instagram",
          username: "tienda_zernio",
          name: "Tienda Zernio",
          platformId: "1789000000002",
        },
      ],
      // Key válida pero sin Instagram todavía: fuerza el camino de connect.
      "sk_e2e_zernio_key_empty": [],
    },
    zernioWebhooks: {},
    revoked: [],
    oauthCodes: {},
    counter: 0,
    seal: newSeal(),
  };
}

export function getIgMockState(): IgMockState {
  if (!g.__igMockState) g.__igMockState = fresh();
  return g.__igMockState;
}

export function resetIgMockState(): void {
  g.__igMockState = fresh();
}

export function nextIgN(): number {
  return ++getIgMockState().counter;
}

export function nextIgMid(prefix = "m_mock"): string {
  const s = getIgMockState();
  return `${prefix}.${s.seal}.${nextIgN()}`;
}

/** Resuelve el perfil de un token del mock (los `-expired` fallan como Meta). */
export function profileForToken(token: string): IgMockProfile | null {
  if (!token || token.endsWith("-invalid") || token.endsWith("-expired")) return null;
  const s = getIgMockState();
  if (s.revoked.includes(token)) return null;
  if (s.tokens[token]) return s.tokens[token];
  // Cualquier otro token "ig-tok-*" vale y representa al negocio por defecto,
  // salvo que codifique su propio IG_ID: ig-tok-<id>.
  if (token.startsWith("ig-tok-")) {
    const id = token.slice("ig-tok-".length);
    return /^\d{6,}$/.test(id)
      ? { igUserId: id, username: `cuenta_${id.slice(-4)}`, name: `Cuenta ${id.slice(-4)}` }
      : DEFAULT_BUSINESS;
  }
  return null;
}
