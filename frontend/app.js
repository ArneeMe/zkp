import { ZKPassport } from "@zkpassport/sdk"
import QRCode from "qrcode"

// Accumulated proofs from onProofGenerated; sent to the Worker for server-side verify().
let collectedProofs = []
let zkPassport = null
let currentRequestId = null

// ── DOM refs ──────────────────────────────────────────────────────────────────

const modal = {
  el: null,
  status: null,
  canvas: null,
  qrLoading: null,
  deeplinkBtn: null,
}

// ── Session check ─────────────────────────────────────────────────────────────

async function checkSession() {
  try {
    const res = await fetch("/api/session/check")
    const { verified } = await res.json()
    if (verified) unlockForum()
  } catch {
    // Silently ignore – not verified is the safe default.
  }
}

// ── Forum unlock ──────────────────────────────────────────────────────────────

function unlockForum() {
  document.getElementById("locked-section")?.remove()
  document.getElementById("verify-section")?.remove()
  document.getElementById("verified-badge").style.display = "flex"
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function setStatus(text, isError = false) {
  modal.status.textContent = text
  modal.status.classList.toggle("error", isError)
}

function showQR(url) {
  modal.qrLoading.style.display = "none"
  modal.canvas.style.display = "block"
  QRCode.toCanvas(modal.canvas, url, { width: 230, margin: 1, color: { dark: "#003087" } })
    .catch(() => {
      modal.qrLoading.textContent = "QR-kode feil — bruk lenken nedenfor"
      modal.qrLoading.style.display = "block"
      modal.canvas.style.display = "none"
    })
}

function openModal() {
  modal.canvas.style.display = "none"
  modal.qrLoading.style.display = "block"
  modal.qrLoading.textContent = "Laster inn…"
  modal.deeplinkBtn.href = "#"
  setStatus("Kobler til…")
  modal.el.classList.remove("hidden")
  document.getElementById("modal-close").focus()
}

function closeModal() {
  modal.el.classList.add("hidden")
  if (zkPassport && currentRequestId) {
    try { zkPassport.cancelRequest(currentRequestId) } catch {}
  }
  collectedProofs = []
  currentRequestId = null
  zkPassport = null
}

// ── Verification flow ─────────────────────────────────────────────────────────

async function startVerification() {
  openModal()

  // 1. Fetch config from server (scope, devMode, domain).
  let config
  try {
    const res = await fetch("/api/verify/config")
    config = await res.json()
  } catch {
    setStatus("Kunne ikke koble til serveren. Prøv igjen.", true)
    return
  }

  // 2. Initialise the ZKPassport SDK in the browser.
  //    The SDK opens a WebSocket bridge here; callbacks fire as the mobile app responds.
  try {
    zkPassport = new ZKPassport(config.domain)
  } catch {
    setStatus("SDK-feil. Prøv igjen.", true)
    return
  }

  let queryResult
  try {
    const queryBuilder = await zkPassport.request({
      name: config.name,
      logo: `${window.location.origin}/logo.svg`,
      purpose: config.purpose,
      scope: config.scope,
      devMode: config.devMode,
    })

    const {
      url,
      requestId,
      onRequestReceived,
      onGeneratingProof,
      onProofGenerated,
      onResult,
      onReject,
      onError,
    } = queryBuilder.gte("age", 16).done()

    currentRequestId = requestId
    collectedProofs = []

    // Show QR and deep link.
    showQR(url)
    modal.deeplinkBtn.href = url
    setStatus("Skann QR-koden med ZKPassport-appen")

    // 3. Wire up lifecycle callbacks.
    onRequestReceived(() => {
      setStatus("Forespørselen er mottatt – bekreft i appen din")
    })

    onGeneratingProof(() => {
      setStatus("Genererer bevis – vennligst vent…")
    })

    onProofGenerated((proof) => {
      collectedProofs.push(proof)
      setStatus(`Bevis generert (${collectedProofs.length}) – bekrefter…`)
    })

    onReject(() => {
      setStatus("Du avviste forespørselen. Lukk og prøv igjen.", true)
    })

    onError((err) => {
      setStatus(`Feil: ${err}`, true)
    })

    // 4. onResult fires after the SDK has verified the proofs client-side.
    //    We then send them to the Worker for independent server-side verification.
    //    The session cookie is only issued after the server confirms verification.
    onResult(async ({ verified, result }) => {
      if (!verified) {
        setStatus("Beviset er ikke gyldig. Prøv igjen.", true)
        return
      }

      setStatus("Bekrefter alder med server…")

      let serverVerified = false
      try {
        const callbackRes = await fetch("/api/verify/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId,
            proofs: collectedProofs,
            queryResult: result,
          }),
        })

        if (callbackRes.status === 500) {
          // Server-side WASM verification error — see README.
          setStatus("Server-verifisering feilet. Sjekk Worker-loggene.", true)
          return
        }

        const data = await callbackRes.json()
        serverVerified = data.verified === true
      } catch {
        setStatus("Nettverksfeil. Prøv igjen.", true)
        return
      }

      if (!serverVerified) {
        setStatus("Server-verifisering mislyktes.", true)
        return
      }

      // 5. Exchange requestId for a session cookie.
      setStatus("Alder bekreftet! Åpner forum…")
      try {
        await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId }),
        })
      } catch {
        // Cookie issuance failed; user will need to re-verify on next visit but
        // we still unlock for this session.
      }

      setTimeout(() => {
        closeModal()
        unlockForum()
      }, 700)
    })
  } catch (err) {
    setStatus(`Kunne ikke starte verifisering: ${err?.message ?? err}`, true)
  }
}

// ── Initialise ────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  modal.el = document.getElementById("modal")
  modal.status = document.getElementById("modal-status")
  modal.canvas = document.getElementById("qr-canvas")
  modal.qrLoading = document.getElementById("qr-loading")
  modal.deeplinkBtn = document.getElementById("deeplink-btn")

  document.getElementById("verify-btn")?.addEventListener("click", startVerification)
  document.getElementById("modal-close")?.addEventListener("click", closeModal)
  document.getElementById("modal-backdrop")?.addEventListener("click", closeModal)

  // Close on Escape.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.el.classList.contains("hidden")) closeModal()
  })

  checkSession()
})
