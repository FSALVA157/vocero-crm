/**
 * 011 — Estado en memoria del kapso-mock (solo dev/test), en globalThis como
 * el wa-mock: los webhooks `kind:"meta"` que Vocero registró por número.
 */

export type KapsoMockWebhook = {
  id: string;
  phoneNumberId: string;
  url: string;
  kind: "kapso" | "meta";
  secret: string;
  active: boolean;
  createdAt: string;
};

type KapsoMockState = {
  webhooks: KapsoMockWebhook[];
  /** API keys "revocadas" por el guion (simula una key borrada en Kapso). */
  revoked: string[];
  counter: number;
};

const g = globalThis as unknown as { __kapsoMockState?: KapsoMockState };

export function getKapsoMockState(): KapsoMockState {
  if (!g.__kapsoMockState) g.__kapsoMockState = { webhooks: [], revoked: [], counter: 0 };
  return g.__kapsoMockState;
}

export function nextKapsoId(prefix: string): string {
  return `${prefix}_${++getKapsoMockState().counter}`;
}

/**
 * Números del proyecto de una API key de prueba, derivados de la key para que
 * cada guion tenga los suyos sin estado: `kapso-<slug>` → `kpn-<slug>`.
 * Sufijos: `-invalid` (401), `-empty` (sin números), `-two` (dos números),
 * `-nowaba` (sin WABA), `-processing` (Kapso procesa entrantes por su cuenta).
 */
export function mockNumbersForKey(key: string) {
  if (key.includes("-empty")) return [];
  const slug = key.replace(/^kapso-/, "").replace(/-(two|nowaba|processing)/g, "");
  const base = {
    business_account_id: key.includes("-nowaba") ? null : `kwaba-${slug}`,
    inbound_processing_enabled: key.includes("-processing"),
    status: "CONNECTED",
    quality_rating: "GREEN",
    is_coexistence: false,
  };
  const numbers = [
    {
      ...base,
      id: `kpn-${slug}`,
      phone_number_id: `kpn-${slug}`,
      name: "Principal",
      display_phone_number: "+1 203-516-9205",
      verified_name: "Kapso Mock",
    },
  ];
  if (key.includes("-two")) {
    numbers.push({
      ...base,
      id: `kpn-${slug}-b`,
      phone_number_id: `kpn-${slug}-b`,
      name: "Secundario",
      display_phone_number: "+1 203-516-0000",
      verified_name: "Kapso Mock B",
    });
  }
  return numbers;
}
