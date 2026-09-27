// Reads server secrets in a way that works on every runtime we deploy to.
//
// On Cloudflare Workers, secrets arrive on the `env` binding passed to
// fetch(). `process.env` only mirrors them under some compatibility settings,
// so a secret added in Lovable can be invisible there. src/server.ts hands us
// the binding on every request; local dev (Node) falls back to process.env.

let workerEnv: Record<string, unknown> | undefined;

export function setWorkerEnv(env: unknown) {
  if (env && typeof env === "object") workerEnv = env as Record<string, unknown>;
}

export function serverEnv(name: string): string | undefined {
  // Nitro's Cloudflare preset also parks the binding on globalThis.__env__.
  const bindings = workerEnv ?? (globalThis as { __env__?: Record<string, unknown> }).__env__;
  const fromWorker = bindings?.[name];
  if (typeof fromWorker === "string" && fromWorker.trim()) return fromWorker.trim();
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return fromProcess?.trim() || undefined;
}
