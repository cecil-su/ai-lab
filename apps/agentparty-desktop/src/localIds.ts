export function makeLocalId(prefix: string, now = Date.now()): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${now}-${Math.random().toString(16).slice(2)}`;
}
