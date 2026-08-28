/**
 * Bitácora en memoria de las llamadas al ai-mock (005).
 *
 * Existe para que el self-test pueda demostrar el aislamiento entre
 * organizaciones: que cada agente llama al proveedor con SU clave y no con la
 * de otra. Guarda solo los últimos 4 de la clave y el modelo — nunca la clave,
 * porque incluso en un mock un secreto en memoria es un secreto que se puede
 * volcar en un log.
 *
 * En globalThis: los módulos pueden evaluarse más de una vez en dev.
 */

export type AiMockCall = {
  at: string;
  model: string | null;
  tokenLast4: string | null;
};

const MAX = 100;

const globalForCalls = globalThis as unknown as {
  __aiMockCalls?: AiMockCall[];
};

function store(): AiMockCall[] {
  if (!globalForCalls.__aiMockCalls) globalForCalls.__aiMockCalls = [];
  return globalForCalls.__aiMockCalls;
}

export function recordAiMockCall(input: {
  authorization: string | null;
  model: unknown;
}): void {
  const token = input.authorization?.replace(/^Bearer\s+/i, "").trim();
  const calls = store();
  calls.push({
    at: new Date().toISOString(),
    model: typeof input.model === "string" ? input.model : null,
    tokenLast4: token ? token.slice(-4) : null,
  });
  if (calls.length > MAX) calls.splice(0, calls.length - MAX);
}

export function listAiMockCalls(): AiMockCall[] {
  return [...store()];
}

export function clearAiMockCalls(): void {
  store().length = 0;
}
