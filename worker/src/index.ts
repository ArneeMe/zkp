// Barretenberg (used inside @zkpassport/sdk's verify()) checks `typeof window`
// to decide whether to use browser mode (fetch CRS from CDN) or Node mode (/tmp
// filesystem). Workers have no /tmp, but they can fetch. Setting window here
// means verify() uses CDN mode. This runs before any request is handled.
if (typeof (globalThis as any).window === "undefined") {
  ;(globalThis as any).window = globalThis
}

import { handleVerifyCallback, handleVerifyConfig, handleHealth } from "./verify"
import { handleSession, handleSessionCheck } from "./session"

export interface Env {
  KV: KVNamespace
  ASSETS: Fetcher
  DEV_MODE: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // All non-API paths are served from the static frontend assets.
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request)
    }

    try {
      const { pathname: path, method } = { pathname: url.pathname, method: request.method }

      if (path === "/api/health" && method === "GET") {
        return handleHealth(request, env)
      }
      if (path === "/api/verify/config" && method === "GET") {
        return handleVerifyConfig(request, env)
      }
      if (path === "/api/verify/callback" && method === "POST") {
        return handleVerifyCallback(request, env)
      }
      if (path === "/api/session" && method === "POST") {
        return handleSession(request, env)
      }
      if (path === "/api/session/check" && method === "GET") {
        return handleSessionCheck(request, env)
      }

      return Response.json({ error: "Not found" }, { status: 404 })
    } catch (err) {
      console.error("Unhandled error:", err)
      return Response.json({ error: "Internal server error" }, { status: 500 })
    }
  },
}
