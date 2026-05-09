// Polyfill window so @aztec/bb.js uses CDN mode instead of /tmp filesystem.
if (typeof (globalThis as any).window === "undefined") {
  ;(globalThis as any).window = globalThis
}

import { handleVerifyCallback } from "../../../worker/src/verify"

interface Env { KV: KVNamespace; DEV_MODE: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  return handleVerifyCallback(request, env)
}
