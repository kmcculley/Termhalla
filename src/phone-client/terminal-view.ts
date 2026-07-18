/**
 * The full-screen terminal view (feature 0026, REQ-011/REQ-013/REQ-023/REQ-030): renders one
 * pane's xterm.js buffer at the pane's CURRENT cols/rows (sized from the freshest known grid
 * BEFORE the snapshot is applied — `openPanePlan`, REQ-013) with pinch-zoom/pan for fit, and wires
 * the accessory key-bar (./key-bar) into `input` messages. `term.onData` (soft-keyboard/typed
 * input) routes through the SAME Ctrl latch a key-bar tap uses (`transformTyped`, v2 —
 * FINDING-033), so Ctrl+C is producible by tapping Ctrl then typing 'c'.
 *
 * v2 (REQ-030 — closes FINDING-035): the actively-viewed pane's exit renders an in-view
 * "process exited" notice as an overlay and disables further input for it — the hidden pane
 * list's status chip alone is not sufficient.
 */
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { createKeyBar } from './key-bar'
import { openPanePlan, type PaneSink } from './ws-client'

export interface InputMessage {
  type: 'input'
  paneId: string
  data: string
}

export interface TerminalViewOptions {
  container: HTMLElement
  keyBarContainer: HTMLElement
  /** Accepts `input` messages (the view's own traffic) AND `subscribe` (emitted by `open()` per
   *  `openPanePlan` — size-before-subscribe, REQ-013) over the SAME outbound channel `main.ts`
   *  wires to the live WS connection. */
  send: (msg: InputMessage | { type: 'subscribe'; paneId: string }) => void
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
  private paneId: string | undefined
  private exited = false
  private exitOverlay: HTMLDivElement
  private ctrlButton: HTMLButtonElement | undefined

  constructor(private opts: TerminalViewOptions) {
    this.term = new Terminal({ convertEol: false, cursorBlink: true, allowProposedApi: true })
    this.term.open(opts.container)

    this.exitOverlay = document.createElement('div')
    this.exitOverlay.className = 'terminal-exit-overlay'
    this.exitOverlay.hidden = true
    this.exitOverlay.textContent = 'Process exited — this pane is no longer accepting input.'
    opts.container.appendChild(this.exitOverlay)

    // Pinch-zoom/pan is handled by the container's own CSS (touch-action + overflow) — the
    // terminal itself is rendered at the server's grid, never fitted to the viewport locally.
    this.term.onData((data) => {
      if (this.exited || !this.paneId) return
      const transformed = this.keyBar.transformTyped(data)
      // The latch may have just been consumed by this typed datum (Ctrl then a typed letter) —
      // keep the button's visual state in sync so it doesn't look armed after it fired.
      this.ctrlButton?.classList.toggle('key-bar-key--active', this.keyBar.isCtrlLatched())
      opts.send({ type: 'input', paneId: this.paneId, data: transformed })
    })
    this.renderKeyBar()
  }

  /** Opens (or switches to) a pane: sizes the terminal from the freshest known grid FIRST, then
   *  subscribes — a non-80x24 pane never renders mis-wrapped for even one frame (REQ-013). */
  open(pane: { paneId: string; cols: number; rows: number }): void {
    this.paneId = pane.paneId
    this.exited = false
    this.exitOverlay.hidden = true
    for (const step of openPanePlan(pane)) {
      if (step.op === 'size') this.setGrid(step.cols, step.rows)
      else this.opts.send({ type: 'subscribe', paneId: step.paneId })
    }
  }

  /** Switch which live pane this view targets WITHOUT re-sizing/re-subscribing (a fresh attach is
   *  triggered separately via `open()`) — kept for callers that only need to redirect input. */
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

  /** The actively-viewed pane exited: an in-view notice, input disabled (REQ-030). */
  setExited(): void {
    this.exited = true
    this.exitOverlay.hidden = false
  }

  private renderKeyBar(): void {
    this.opts.keyBarContainer.innerHTML = ''
    for (const { key, label } of KEYS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'key-bar-key'
      btn.textContent = label
      btn.dataset.key = key
      btn.dataset.testid = `key-${key}`
      btn.addEventListener('click', () => {
        if (this.exited || !this.paneId) return
        const bytes = this.keyBar.press(key)
        if (bytes) this.opts.send({ type: 'input', paneId: this.paneId, data: bytes })
        btn.classList.toggle('key-bar-key--active', this.keyBar.isCtrlLatched())
      })
      if (key === 'ctrl') this.ctrlButton = btn
      this.opts.keyBarContainer.appendChild(btn)
    }
  }

  destroy(): void {
    this.term.dispose()
  }
}
