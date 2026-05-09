import type { Env } from "./index"

const COOKIE_NAME = "zkp_session"
const SESSION_TTL = 86400 // 24 hours in seconds

// POST /api/session
// Exchanges a verified requestId for an httpOnly session cookie.
// Only issues a cookie if KV records the requestId as server-verified.
export async function handleSession(request: Request, env: Env): Promise<Response> {
  let body: { requestId?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { requestId } = body
  if (!requestId) {
    return Response.json({ error: "Missing requestId" }, { status: 400 })
  }

  const raw = await env.KV.get(`request:${requestId}`)
  if (!raw) {
    return Response.json({ error: "Ikke verifisert" }, { status: 403 })
  }

  const record = JSON.parse(raw) as { verified: boolean }
  if (!record.verified) {
    return Response.json({ error: "Ikke verifisert" }, { status: 403 })
  }

  const token = crypto.randomUUID()
  await env.KV.put(
    `session:${token}`,
    JSON.stringify({ verified: true, created: Date.now() }),
    { expirationTtl: SESSION_TTL },
  )

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": [
        `${COOKIE_NAME}=${token}`,
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        `Max-Age=${SESSION_TTL}`,
        "Path=/",
      ].join("; "),
    },
  })
}

// GET /api/session/check
// Returns { verified: true } if the request carries a valid session cookie.
export async function handleSessionCheck(request: Request, env: Env): Promise<Response> {
  const token = parseCookie(request.headers.get("Cookie") ?? "", COOKIE_NAME)
  if (!token) {
    return Response.json({ verified: false })
  }

  const raw = await env.KV.get(`session:${token}`)
  if (!raw) {
    return Response.json({ verified: false })
  }

  const record = JSON.parse(raw) as { verified: boolean }
  return Response.json({ verified: record.verified === true })
}

function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=")
    if (k === name && v) return decodeURIComponent(v)
  }
  return undefined
}
