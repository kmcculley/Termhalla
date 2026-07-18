/**
 * The phone client's entry point (feature 0026, REQ-023/REQ-024): wires token bootstrap, the
 * single multiplexed WS connection, the pane list, and the terminal view together. On first load
 * from a pairing URL the token is stored client-side and IMMEDIATELY stripped from the visible
 * URL via `history.replaceState` (it must not linger in browser history); a dropped connection
 * retries with the stored token and performs a fresh REQ-009 attach per subscribed pane.
 */
import { extractTokenFromUrl, createTokenStorage } from './token-storage'
import { applyPaneMessage, reconnectAttachPlan } from './ws-client'
import { PaneList, type WorkspaceGroup } from './pane-list'
import { TerminalView } from './terminal-view'

const tokenStorage = createTokenStorage(window.localStorage)

function bootstrapToken(): string | undefined {
  const { token, cleanedHref } = extractTokenFromUrl(window.location.href)
  if (token) {
    tokenStorage.save(token)
    window.history.replaceState(null, '', cleanedHref)
    return token
  }
  return tokenStorage.load()
}

const token = bootstrapToken()

const paneListEl = document.getElementById('pane-list') as HTMLElement
const terminalEl = document.getElementById('terminal') as HTMLElement
const keyBarEl = document.getElementById('key-bar') as HTMLElement
const listView = document.getElementById('view-list') as HTMLElement
const termView = document.getElementById('view-terminal') as HTMLElement
const backButton = document.getElementById('back-button')
const statusEl = document.getElementById('connection-status')

let ws: WebSocket | undefined
let activePaneId: string | undefined
let terminalView: TerminalView | undefined
const subscribed = new Set<string>()
let reconnectTimer: ReturnType<typeof setTimeout> | undefined

const send = (msg: Record<string, unknown>): void => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

const setConnectionStatus = (text: string): void => {
  if (statusEl) statusEl.textContent = text
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
  activePaneId = paneId
  subscribed.add(paneId)
  if (!terminalView) {
    terminalView = new TerminalView({ container: terminalEl, keyBarContainer: keyBarEl, paneId, send: send as never })
  } else {
    terminalView.setPane(paneId)
  }
  showTerminal()
  send({ type: 'subscribe', paneId })
})

backButton?.addEventListener('click', () => showList())

function handleMessage(msg: Record<string, unknown>): void {
  switch (msg.type) {
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
      if (typeof msg.paneId === 'string') paneList.setStatus(msg.paneId, 'exited')
      break
    default:
      break
  }
}

function scheduleReconnect(): void {
  setConnectionStatus('reconnecting…')
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect() }, 2000)
}

function connect(): void {
  if (!token) { setConnectionStatus('no pairing token — scan the QR code again'); return }
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${wsProtocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
  ws = new WebSocket(url)
  ws.addEventListener('open', () => {
    setConnectionStatus('connected')
    // REQ-024: reconnect is a fresh attach — never assumed stream continuity.
    for (const intent of reconnectAttachPlan([...subscribed])) send(intent)
  })
  ws.addEventListener('message', (event) => {
    let msg: Record<string, unknown>
    try { msg = JSON.parse(String(event.data)) } catch { return }
    handleMessage(msg)
  })
  ws.addEventListener('close', scheduleReconnect)
  ws.addEventListener('error', () => { /* the close event that follows drives the reconnect */ })
}

connect()
