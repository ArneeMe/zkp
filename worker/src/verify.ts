import { ZKPassport } from "@zkpassport/sdk"

interface Env { KV: KVNamespace; DEV_MODE: string }

const SCOPE = "diskusjonsforum-alder-16"

// GET /api/health
// Tests that the SDK loads and createQuery() works (no WASM required).
// Hit this endpoint first after deploying to confirm the SDK is operational.
export async function handleHealth(_request: Request, _env: Env): Promise<Response> {
  try {
    const zkp = new ZKPassport("health-check.example.com")
    const result = zkp.createQuery().gte("age", 16).done() as { query: Record<string, unknown> }
    return Response.json({ ok: true, sdkLoaded: true, queryKeys: Object.keys(result.query) })
  } catch (err) {
    return Response.json({ ok: false, sdkLoaded: false, error: String(err) }, { status: 500 })
  }
}

// GET /api/verify/config
// Returns the parameters the frontend needs to initialise the ZKPassport SDK.
// Keeping these server-side means the frontend never hardcodes scope / devMode.
export function handleVerifyConfig(request: Request, env: Env): Response {
  const domain = new URL(request.url).hostname
  return Response.json({
    domain,
    scope: SCOPE,
    name: "Diskusjonsforum.no",
    purpose: "Bekreft at du er over 16 år for å lese diskusjoner",
    devMode: env.DEV_MODE === "true",
  })
}

// POST /api/verify/callback
// Called by the frontend after onResult fires. Receives the proofs and queryResult
// that the ZKPassport SDK collected on the client, then independently re-verifies
// them server-side. This is the only verification that counts.
//
// NOTE ON WASM: zkpassport's verify() uses @aztec/bb.js (Barretenberg) for SNARK
// verification. Barretenberg downloads a ~43 MB CRS on the first cold call; expect
// 20-60 s on the first request. Subsequent calls within the same Worker isolate are
// fast. If this fails (e.g. memory limits), see README for the fallback option.
export async function handleVerifyCallback(request: Request, env: Env): Promise<Response> {
  let body: { requestId?: string; proofs?: unknown[]; queryResult?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { requestId, proofs, queryResult } = body
  if (!requestId || !Array.isArray(proofs) || proofs.length === 0 || !queryResult) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  // Prevent replay: each requestId may only be used once.
  const existing = await env.KV.get(`request:${requestId}`)
  if (existing) {
    const record = JSON.parse(existing) as { verified: boolean }
    return Response.json({ verified: record.verified })
  }

  const domain = new URL(request.url).hostname
  const devMode = env.DEV_MODE === "true"
  const zkp = new ZKPassport(domain)

  // Reconstruct the original query server-side so the client cannot tamper with it.
  const { query: originalQuery } = zkp.createQuery().gte("age", 16).done() as {
    query: Record<string, unknown>
  }

  let verified = false
  let uniqueIdentifier: string | undefined

  try {
    const result = await zkp.verify({
      proofs: proofs as Parameters<typeof zkp.verify>[0]["proofs"],
      originalQuery: originalQuery as Parameters<typeof zkp.verify>[0]["originalQuery"],
      queryResult: queryResult as Parameters<typeof zkp.verify>[0]["queryResult"],
      scope: SCOPE,
      devMode,
    })
    verified = result.verified
    uniqueIdentifier = result.uniqueIdentifier
  } catch (err) {
    console.error("zkp.verify() threw:", err)
    // Surface the error so the caller knows this is a server fault, not a bad proof.
    return Response.json(
      { error: "Verification engine error — see Worker logs", verified: false },
      { status: 500 },
    )
  }

  // Store only non-PII data in KV.
  await env.KV.put(
    `request:${requestId}`,
    JSON.stringify({
      requestId,
      verified,
      uniqueIdentifier: verified ? uniqueIdentifier : undefined,
      timestamp: Date.now(),
    }),
    { expirationTtl: 86400 },
  )

  return Response.json({ verified })
}
