# Diskusjonsforum.no – ZKPassport age-verification demo

A proof-of-concept: a fake Norwegian discussion forum gated behind a "must be over 16"
check powered by [ZKPassport](https://zkpassport.id). No personal data is stored —
only a zero-knowledge proof that the user's age ≥ 16.

---

## How it works

```
Browser                        Worker (Cloudflare)          ZKPassport bridge
  │                                │                              │
  │  GET /api/verify/config        │                              │
  │─────────────────────────────►  │                              │
  │  ◄── { scope, devMode, … }     │                              │
  │                                │                              │
  │  new ZKPassport(domain)        │                              │
  │  .request(…).gte("age",16)     │                              │
  │  .done()  ──── WebSocket ─────────────────────────────────►  │
  │  ◄── { url, requestId }        │                         (bridge open)
  │                                │                              │
  │  [Show QR / deep link]         │                              │
  │                                │                              │
  │  [User scans with ZKPassport app on phone]                    │
  │                    ◄── proof ─────────────────────────────── │
  │  onProofGenerated (accumulate)                                │
  │  onResult (SDK verified client-side)                          │
  │                                │                              │
  │  POST /api/verify/callback     │                              │
  │   { requestId, proofs,         │                              │
  │     queryResult }              │                              │
  │─────────────────────────────►  │                              │
  │                        zkp.verify() ← server-side SNARK check│
  │                        KV.put(requestId, { verified })        │
  │  ◄── { verified: true }        │                              │
  │                                │                              │
  │  POST /api/session { requestId}│                              │
  │─────────────────────────────►  │                              │
  │                        KV.get(requestId) ✓                   │
  │                        Set-Cookie: zkp_session=…              │
  │  ◄── Set-Cookie                │                              │
  │                                │                              │
  │  [Forum unlocked 🎉]           │                              │
```

The **Worker is the only trust anchor**. The browser's `onResult` is UX feedback;
the session cookie is only issued after the Worker independently re-verifies the proof.

---

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
  (`npm install -g wrangler`) v 3.78.0 or later
- A free Cloudflare account (Workers + KV)
- The [ZKPassport app](https://zkpassport.id) on your phone

---

## Deploy

### 1. Create a KV namespace

```bash
cd worker
npx wrangler kv namespace create SESSIONS
# Note the `id` and `preview_id` from the output
```

Edit `worker/wrangler.toml` and replace:
```toml
id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_YOUR_KV_NAMESPACE_PREVIEW_ID"
```

### 2. Install dependencies

```bash
cd worker && npm install
```

(The build step installs the frontend deps automatically.)

### 3. Deploy

```bash
cd worker
npm run deploy
```

This:
1. Installs `frontend/` deps and runs `esbuild` to produce `frontend/app.bundle.js`
2. Runs `wrangler deploy`, which uploads the Worker + all frontend static assets

Your site is now live at `https://diskusjonsforum.<your-subdomain>.workers.dev`.

---

## Local development

```bash
cd worker
npm run dev
```

Opens at `http://localhost:8787`. The `DEV_MODE = "true"` variable is set in
`wrangler.toml`, so the ZKPassport app accepts mock "Zero Knowledge Republic" passports.

---

## Dev mode (testing without a real passport)

`DEV_MODE = "true"` in `wrangler.toml` enables ZKPassport's dev mode:

- The ZKPassport mobile app has a built-in **mock passport** from the Zero Knowledge Republic (ZKR).
- Open the app → tap the ≡ menu → **Developer mode** → enable it.
- Scan the QR as normal; the mock passport satisfies `age ≥ 16`.

Set `DEV_MODE = "false"` (or remove the var) when you want to require a real passport.

---

## Confirm the SDK loads in the Worker

After deploying, hit the health endpoint:

```
GET https://diskusjonsforum.<subdomain>.workers.dev/api/health
```

Expected response:
```json
{ "ok": true, "sdkLoaded": true, "queryKeys": ["age"] }
```

If `ok` is `false`, the SDK failed to load — check the Worker logs with
`wrangler tail --format pretty`.

---

## ⚠️ Known limitation: server-side WASM verification

`zkpassport.verify()` uses **@aztec/bb.js** (Barretenberg) for SNARK proof
verification. Barretenberg downloads a ~43 MB Common Reference String (CRS) on its
first call. In Cloudflare Workers:

- **Cold start**: the first `/api/verify/callback` request will be slow (20-60 s
  on a free-tier Worker) as it downloads the CRS.
- **Memory**: the CRS fits within the 128 MB Workers memory limit.
- **Subsequent requests** within the same isolate are fast (CRS stays in memory).

If `verify()` throws a `500` error:
1. Check `wrangler tail` for the stack trace.
2. If it's a `WASM instantiation` or `out of memory` error, upgrade to a **Workers
   Paid** plan (higher CPU and memory limits).
3. As a last resort for the demo, you can temporarily comment out the `verify()` call
   in `worker/src/verify.ts` and trust only the public-input check — but note this
   weakens security and must not be used in production.

---

## Environment variables

| Variable   | Where            | Default  | Description                          |
|------------|------------------|----------|--------------------------------------|
| `DEV_MODE` | `wrangler.toml`  | `"true"` | Accept ZKR mock proofs for testing   |

No secrets are required — ZKPassport is keyless by design.

---

## File structure

```
.
├── frontend/
│   ├── index.html        Forum landing page
│   ├── style.css         Norwegian-themed styling
│   ├── app.js            SDK + QR logic (source)
│   ├── app.bundle.js     Built by esbuild (gitignored)
│   ├── logo.svg          Forum logo
│   └── package.json      esbuild + SDK deps
└── worker/
    ├── src/
    │   ├── index.ts      Router + static-asset passthrough
    │   ├── verify.ts     /api/verify/* endpoints
    │   └── session.ts    /api/session/* endpoints
    ├── wrangler.toml     Cloudflare config (edit KV IDs here)
    ├── tsconfig.json
    └── package.json      Build + deploy scripts
```
