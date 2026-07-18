/**
 * The full-screen terminal view (feature 0026, REQ-011/REQ-013/REQ-023): renders one pane's
 * xterm.js buffer at the pane's CURRENT cols/rows (a `grid` push from the server — the phone
 * never originates a resize, REQ-013) with pinch-zoom/pan for fit, and wires the accessory
 * key-bar (./key-bar) into `input` messages.
 */
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { createKeyBar } from './key-bar'
import type { PaneSink } from './ws-client'

export interface InputMessage {
  type: 'input'
  paneId: string
  data: string
}

export interface TerminalViewOptions {
  container: HTMLElement
  keyBarContainer: HTMLElement
  paneId: string
  send: (msg: InputMessage) => void
}

const KEYS: Array<{ key: string; label: string }> = [
  { key: 'ctrl', label: 'Ctrl' },
  { key: 'esc', label: 'Esc' },
  { key: 'tab', label: 'Tab' },
  { key: 'up', label: '↑' },
  { key: 'down', label: '↓' },
  { key: 'left', label: '←' },
  { key: 'right', label: '→' }
]

export class TerminalView {
  private term: Terminal
  private keyBar = createKeyBar()
  private paneId: string

  constructor(private opts: TerminalViewOptions) {
    this.paneId = opts.paneId
    this.term = new Terminal({ convertEol: false, cursorBlink: true, allowProposedApi: true })
    this.term.open(opts.container)
    // Pinch-zoom/pan is handled by the container's own CSS (touch-action + overflow) — the
    // terminal itself is rendered at the server's grid, never fitted to the viewport locally.
    this.term.onData((data) => {
      opts.send({ type: 'input', paneId: this.paneId, data })
    })
    this.renderKeyBar()
  }

  /** Switch which live pane this view targets (e.g. tapping a different pane-list row) — a fresh
   *  attach (snapshot/resync) is what actually repaints the buffer; this only redirects input. */
  setPane(paneId: string): void {
    this.paneId = paneId
  }

  sink(): PaneSink {
    return {
      write: (data: string) => { this.term.write(data) },
      reset: () => { this.term.reset() }
    }
  }

  /** Applies the server's authoritative grid (REQ-013 — the ONLY sanctioned resize source). */
  setGrid(cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.term.resize(cols, rows)
  }

  private renderKeyBar(): void {
    this.opts.keyBarContainer.innerHTML = ''
    for (const { key, label } of KEYS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'key-bar-key'
      btn.textContent = label
      btn.dataset.key = key
      btn.addEventListener('click', () => {
        const bytes = this.keyBar.press(key)
        if (bytes) this.opts.send({ type: 'input', paneId: this.paneId, data: bytes })
        btn.classList.toggle('key-bar-key--active', this.keyBar.isCtrlLatched())
      })
      this.opts.keyBarContainer.appendChild(btn)
    }
  }

  destroy(): void {
    this.term.dispose()
  }
}
