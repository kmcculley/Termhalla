/**
 * The phone client's entry point (feature 0026, REQ-023/REQ-024/REQ-028/REQ-030): wires the
 * single multiplexed WS connection, the pane list, and the terminal view together.
 *
 * v2 (ESC-001 loopback): the pairing token is used ONCE (server-side, via the `?token=` query
 * param on THIS page load) to authenticate and set the REQ-028 HttpOnly session cookie — the
 * client never stores the plaintext token itself (no localStorage/sessionStorage/script cookie);
 * the token is stripped from the visible URL immediately (`history.replaceState`) so it never
 * lingers in browser history, and every later request (including the WS upgrade) authenticates
 * via the browser's own automatically-sent session cookie. A dropped connection retries with
 * capped exponential backoff, distinguishing a transient blip from a revoked pairing (a terminal
 * "scan the new QR code" state) — never an infinite silent retry loop.
 */
import { extractTokenFromUrl } from './token-storage'
import {
  applyPaneMessage, createMessageGate, reconnectDelayMs, reconnectOutcome, paneSwitchPlan
} from './ws-client'
import { PaneList, type WorkspaceGroup } from './pane-list'
import { TerminalView } from './terminal-view'
import { PHONE_REMOTE_PROTO_VERSION } from '@shared/phone-remote/protocol'

// REQ-023: the token is used server-side by THIS load's `GET /?token=…` (which set the durable
// session cookie); it must not linger in the visible URL/history. No token is stored client-side.
const { cleanedHref } = extractTokenFromUrl(window.location.href)
if (cleanedHref !== window.location.href) window.history.replaceState(null, '', cleanedHref)

const paneListEl = document.getElementById('pane-list') as HTMLElement
const terminalEl = document.getElementById('terminal') as HTMLElement
const keyBarEl = document.getElementById('key-bar') as HTMLElement
const listView = document.getElementById('view-list') as HTMLElement
const termView = document.getElementById('view-terminal') as HTMLElement
const backButton = document.getElementById('back-button')
const statusEl = document.getElementById('connection-status')
const errorBanner = document.getElementById('error-banner')

let ws: WebSocket | undefined
let activePaneId: string | undefined
let terminalView: TerminalView | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let reconnectAttempt = 0
let consecutiveAuthRefusals = 0
let revoked = false
let connectStartedAt = 0
let receivedHelloThisAttempt = false
let gate = createMessageGate(PHONE_REMOTE_PROTO_VERSION)

const send = (msg: Record<string, unknown>): void => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

const setConnectionStatus = (text: string): void => {
  if (statusEl) statusEl.textContent = text
}

/** Server `error` frames (and local connection notices) become a visible status strip — never
 *  silently discarded (REQ-030 — closes FINDING-035/050). */
const showError = (message: string): void => {
  if (!errorBanner) return
  errorBanner.textContent = message
  errorBanner.hidden = false
}
const clearError = (): void => {
  if (!errorBanner) return
  errorBanner.hidden = true
}

const showList = (): void => {
  listView.hidden = false
  termView.hidden = true
}
const showTerminal = (): void => {
  listView.hidden = true
  termView.hidden = false
}

const paneList = new PaneList(paneListEl, (paneId) => {
  const prev = activePaneId
  for (const step of paneSwitchPlan(prev, paneId)) {
    if (step.type === 'unsubscribe') send(step)
  }
  const info = paneList.getPane(paneId)
  if (!terminalView) {
    terminalView = new TerminalView({ container: terminalEl, keyBarContainer: keyBarEl, send })
  }
  activePaneId = paneId
  showTerminal()
  // openPanePlan (inside TerminalView.open) sizes from the freshest known grid BEFORE subscribing
  // (REQ-013) — a non-80x24 pane never renders mis-wrapped for even one frame.
  terminalView.open(info ?? { paneId, cols: 80, rows: 24 })
})

backButton?.setAttribute('data-testid', 'phone-back')
backButton?.addEventListener('click', () => {
  if (activePaneId) send({ type: 'unsubscribe', paneId: activePaneId })
  activePaneId = undefined
  showList()
})

function handleMessage(msg: Record<string, unknown>): void {
  switch (msg.type) {
    case 'hello':
      receivedHelloThisAttempt = true
      break
    case 'panes':
      paneList.setInventory((msg.workspaces as WorkspaceGroup[] | undefined) ?? [])
      break
    case 'status':
      if (typeof msg.paneId === 'string' && typeof msg.status === 'string') {
        paneList.setStatus(msg.paneId, msg.status)
      }
      break
    case 'grid':
      if (msg.paneId === activePaneId && terminalView) {
        terminalView.setGrid(Number(msg.cols), Number(msg.rows))
      }
      break
    case 'snapshot':
    case 'data':
    case 'resync':
      if (msg.paneId === activePaneId && terminalView) {
        applyPaneMessage(terminalView.sink(), msg as { type: string; paneId?: string; data?: string })
      }
      break
    case 'paneExit':
      if (typeof msg.paneId === 'string') {
        paneList.setStatus(msg.paneId, 'exited')
        // REQ-030: the ACTIVELY VIEWED pane's exit gets an in-view notice + disabled input — the
        // hidden list's chip alone is not sufficient.
        if (msg.paneId === activePaneId && terminalView) terminalView.setExited()
      }
      break
    case 'error':
      if (typeof msg.message === 'string') showError(msg.message)
      break
    default:
      break
  }
}

/** Distinguishes a genuinely revoked pairing from a transient blip: after a QUICK close (no
 *  `hello` ever received this attempt, within a short window of the connect call), probe a cheap
 *  authenticated route. A 401 counts as an auth refusal; anything else (network hiccup, server
 *  briefly down) resets the streak so a real blip never falsely trips "revoked" (REQ-024 —
 *  closes FINDING-026/036). */
async function handleClose(): Promise<void> {
  const quickClose = !receivedHelloThisAttempt && Date.now() - connectStartedAt < 1500
  if (quickClose) {
    let refused = false
    try {
      const res = await fetch(window.location.pathname || '/', { credentials: 'same-origin' })
      refused = res.status === 401
    } catch { refused = false }
    consecutiveAuthRefusals = refused ? consecutiveAuthRefusals + 1 : 0
  } else {
    consecutiveAuthRefusals = 0
  }

  if (reconnectOutcome(consecutiveAuthRefusals) === 'revoked') {
    revoked = true
    setConnectionStatus('pairing revoked — scan the new QR code in Termhalla Settings to re-pair')
    return
  }

  reconnectAttempt += 1
  setConnectionStatus('reconnecting…')
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect() }, reconnectDelayMs(reconnectAttempt))
}

function connect(): void {
  if (revoked) return
  connectStartedAt = Date.now()
  receivedHelloThisAttempt = false
  gate = createMessageGate(PHONE_REMOTE_PROTO_VERSION)
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // No token on the wire: the session cookie (set by the initial token-authenticated page load)
  // rides the WS upgrade automatically as a same-origin request (REQ-028).
  const url = `${wsProtocol}//${window.location.host}/ws`
  ws = new WebSocket(url)
  ws.addEventListener('open', () => {
    setConnectionStatus('connected')
    clearError()
    reconnectAttempt = 0
    consecutiveAuthRefusals = 0
    // REQ-024: reconnect is a fresh attach — never assumed stream continuity. Re-sizing from the
    // freshest known grid before re-subscribing keeps REQ-013 honest across a reconnect too.
    if (activePaneId) {
      const info = paneList.getPane(activePaneId)
      terminalView?.open(info ?? { paneId: activePaneId, cols: 80, rows: 24 })
    }
  })
  ws.addEventListener('message', (event) => {
    let msg: Record<string, unknown>
    try { msg = JSON.parse(String(event.data)) } catch { return }
    const decision = gate.accept(msg)
    if (decision === 'reload-required') {
      setConnectionStatus('a new version is available — reloading…')
      window.location.reload()
      return
    }
    if (decision === 'drop') return
    handleMessage(msg)
  })
  ws.addEventListener('close', () => { void handleClose() })
  ws.addEventListener('error', () => { /* the close event that follows drives the reconnect */ })
}

connect()
