import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api'
import { DEFAULT_TERM_SCROLLBACK, type TerminalConfig } from '@shared/types'
import { resolveTheme } from '@shared/theme'
import { matchShortcut, resolveBindings } from '@shared/keymap'
import { useStore, paneCwd } from '../store'
import { domainAllowed } from '../store/remote-gates'
import { useResolvedPaneTheme } from '../use-resolved-theme'
import { normalizeCopiedText } from './terminal-clipboard'
import { registerSerializer, unregisterSerializer, consumeSnapshot, registerFocuser, unregisterFocuser, registerRedrawer, unregisterRedrawer, registerRespawner, unregisterRespawner, respawnPane, registerClearer, unregisterClearer, registerFindOpener, unregisterFindOpener } from './terminal-registry'
import { SURFACE } from './Modal'
import {
  setupAutoResume, setupClipboard, setupCopyOnSelect, setupMiddleClickPaste, setupDragDrop,
  setupVisualBell, setupNewOutputPill, setupWheelZoom, setupAltScreenRepaint
} from './terminal-pane-setup'
import { redraw } from './redraw'
import { syncGrid, type GridSyncDeps } from './grid-sync'
import { shouldAutoResumeClaude } from '../store/pane-ops'
import { registerTerminalLinks } from '../terminal/links'
import { stashReveal } from '../editor/reveal'

/** Scrollback lines captured when serializing a terminal for a window-handoff replay. */
const HANDOFF_SCROLLBACK_LINES = 1000

/** Quiet window after the last resize before we repaint xterm once, so a drag doesn't repaint per frame. */
const RESIZE_SETTLE_MS = 150

/** Bind `syncGrid`'s injected side effects to this pane. Module-level (not a hook) so both fit sites
 *  — the ResizeObserver and the font/theme effect — can share it without perturbing either effect's
 *  hand-curated dependency array. `gridRef` is the single baseline of what the PTY was last told. */
const gridDeps = (
  term: Terminal, fit: FitAddon, gridRef: { current: { cols: number; rows: number } }, paneId: string
): GridSyncDeps => ({
  fit: () => fit.fit(),
  dims: () => ({ cols: term.cols, rows: term.rows }),
  last: () => gridRef.current,
  setLast: (g) => { gridRef.current = g },
  resize: (g) => api.ptyResize({ id: paneId, cols: g.cols, rows: g.rows })
})

export function TerminalPane({ paneId, wsId, config }: { paneId: string; wsId: string; config: TerminalConfig }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const exited = useStore(s => !!s.exited[paneId])
  const isRemote = useStore(s => !!s.workspaces[wsId]?.home)
  const closePane = useStore(s => s.closePane)
  // QoL batch 2026-07-17: visual bell flash, the in-pane find bar, and the scrolled-up
  // "new output" pill. All render as absolutely-positioned overlays — they never change the
  // terminal host's box (the ConPTY-repaint gotcha).
  const [bell, setBell] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [newOutput, setNewOutput] = useState(false)
  /** The grid the PTY was last told about. Shared by every `fit()` site (the ResizeObserver, the
   *  font/theme effect, the redraw command) so none of them can re-grid xterm without telling the
   *  PTY — an unpaired fit desyncs the two and renders garbled. See `grid-sync.ts`. */
  const gridRef = useRef({ cols: 0, rows: 0 })

  useEffect(() => {
    const t0 = resolveTheme(useStore.getState().quick.theme, useStore.getState().workspaces[wsId]?.theme, config.theme)
    const term = new Terminal({
      fontFamily: t0.termFontFamily, fontSize: t0.termFontSize, cursorBlink: true,
      scrollback: useStore.getState().quick.termScrollback ?? DEFAULT_TERM_SCROLLBACK,
      theme: { background: t0.termBg, foreground: t0.termFg }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const search = new SearchAddon()
    term.loadAddon(search)
    searchRef.current = search
    // Serialize the screen + scrollback to ANSI on demand, so this terminal's visible content can
    // be replayed into a new window when its workspace is torn off / re-docked (see WindowManager).
    const serialize = new SerializeAddon()
    term.loadAddon(serialize)
    registerSerializer(paneId, () => serialize.serialize({ scrollback: HANDOFF_SCROLLBACK_LINES }))
    // Report whether focus actually landed: term.focus() is a no-op while the pane is hidden
    // (e.g. its workspace is mid-switch), and requestPaneFocus retries until it sticks.
    registerFocuser(paneId, () => { term.focus(); return document.activeElement === term.textarea })
    termRef.current = term; fitRef.current = fit
    // The one host element every listener-wiring setup below shares (and unwires from on dispose).
    const host = hostRef.current!
    term.open(host)
    fit.fit()
    // The spawn below carries this grid, so it is what the PTY knows. (On ADOPTION main reconciles
    // the live pty to it — see needsGridReconcile — because the pty still carries its old tile's grid.)
    gridRef.current = { cols: term.cols, rows: term.rows }
    /** Re-fit xterm and push the new grid to the PTY iff it actually changed. */
    const sync = () => syncGrid(gridDeps(term, fit, gridRef, paneId))

    // A cross-workspace move stashed this pane's prior scrollback; write it before spawn so it lands
    // ahead of any live output. For a fresh terminal this is '' (no-op). The PTY itself is re-adopted
    // by main (pty:spawn sees pty.has) — this only restores the renderer-side buffer.
    const restored = consumeSnapshot(paneId)
    if (restored) term.write(restored)

    let disposed = false
    // NOT awaited before the listeners below: main's replayInto sends the handoff snapshot as
    // pty:data BEFORE this invoke resolves, so onPtyData must already be registered by then.
    // Remote-home workspace (feature 0022, REQ-008): the spawn carries the routing hint — main
    // routes the pane's whole pty lifecycle over the workspace's agent connection. launch/envId
    // are local-only features a remote pane does not carry (main strips them from the wire).
    const home = useStore.getState().workspaces[wsId]?.home
    const spawned = api.ptySpawn({
      id: paneId, shellId: config.shellId, cwd: config.cwd,
      cols: term.cols, rows: term.rows, launch: config.launch, envId: config.envId, workspaceId: wsId,
      ...(home ? { remote: { workspaceId: wsId, agentId: home.agentId } } : {})
    })
    api.searchSetMuted(paneId, !!config.historyMuted)
    // Remote gate (feature 0022, REQ-017): recording is a local-machine domain — never default-
    // started for a pane of a remote-home workspace (the recorder taps the LOCAL pty data path,
    // which a remote pane does not ride).
    if (useStore.getState().quick.recordByDefault && domainAllowed(useStore.getState(), wsId, 'recording')) api.recStart(paneId)

    // Auto-resume Claude: a pane that had Claude running at last save (config.resumeAi) types
    // `claude --resume` once — after the restored shell has printed its prompt and gone quiet. Using
    // an output-quiet timer (reset on each data chunk) is shell-agnostic: it fires shortly after the
    // prompt appears, not before the shell is ready. Off when the setting is disabled.
    // CRITICAL: only on a genuinely FRESH spawn — NOT when re-adopting a still-running PTY
    // (minimize/restore, cross-workspace move, window handoff), where Claude is already alive and the
    // command would land as a prompt into the live agent. The gate needs BOTH re-adoption signals:
    // `restored` (the renderer stash) covers same-window moves, but in a multi-window undock the
    // destination renderer has no stash — the snapshot rides main's transit buffer — so only main's
    // spawn result (`adopted` = pty.has) knows it's a re-adoption there. The armed want-resume flag
    // stays false until the spawn resolves; data arriving meanwhile just no-ops the quiet timer, and
    // the kick after resolution (re-armed by each later chunk) starts it (mechanics in setupAutoResume).
    const autoResume = setupAutoResume({ typeResume: () => api.ptyWrite({ id: paneId, data: 'claude --resume\r' }) })
    void spawned.then((adopted) => {
      if (disposed) return
      autoResume.arm(shouldAutoResumeClaude({
        resumeAi: config.resumeAi,
        autoResumeEnabled: useStore.getState().quick.autoResumeClaude !== false,
        adoptedLivePty: !!adopted,
        consumedSnapshot: !!restored,
      }))
    })

    const offData = api.onPtyData((id, data) => {
      if (id !== paneId) return
      // pill (atBottom/setNewOutput) is declared below in this effect — callbacks only run after
      // the effect body has completed, so the reference is safe. Same-value setState bails out, so
      // this costs nothing per chunk while the user is at the bottom.
      if (!pill.atBottom()) setNewOutput(true)
      term.write(data); autoResume.onData()
    })
    const offExit = api.onPtyExit((id) => { if (id === paneId && !disposed) term.write('\r\n[process exited]\r\n') })
    const inputDisp = term.onData(d => api.ptyWrite({ id: paneId, data: d }))

    // Clean up a terminal selection before it hits the clipboard (reflow TUI-wrapped lines, trim/
    // collapse blanks) unless the cleanCopy setting is off. Default on. Shared by the clipboard
    // keys and copy-on-select.
    const cleanSel = (s: string) =>
      useStore.getState().quick.cleanCopy === false ? s : normalizeCopiedText(s)
    // Clipboard keys + right-click paste (rationale + the bracketed-paste confirm in setupClipboard).
    const clipboard = setupClipboard(term, host, {
      readClipboard: () => api.clipboardRead(),
      writeClipboard: (t) => api.clipboardWrite(t),
      cleanCopy: cleanSel,
      isAppShortcut: (e) => !!matchShortcut(e, resolveBindings(useStore.getState().quick.keybindings))
    })
    const offCopyOnSelect = setupCopyOnSelect(term, host, {
      enabled: () => useStore.getState().quick.copyOnSelect !== false,
      writeClipboard: (t) => api.clipboardWrite(t),
      cleanCopy: cleanSel
    })
    const offMiddlePaste = setupMiddleClickPaste(host, clipboard.paste)
    const offDragDrop = setupDragDrop(term, host, { pathForFile: (f) => api.pathForFile(f) })

    const offBell = setupVisualBell(term, { setBell })

    // OSC 0/2 window title (e.g. ssh's user@host, vim's filename) → the pane chrome, unless the
    // user set a manual name (PaneTile falls back config.name ?? oscTitle ?? kind).
    const titleDisp = term.onTitleChange(t => useStore.getState().setOscTitle(paneId, t))

    const pill = setupNewOutputPill(host, { setNewOutput })

    // Registry hooks for the clear-terminal and find-in-terminal commands (palette + chords).
    registerClearer(paneId, () => term.clear())
    registerFindOpener(paneId, () => { setFindOpen(true); findInputRef.current?.focus() })

    const offWheelZoom = setupWheelZoom(term, host, {
      setTermFontSize: (next) => useStore.getState().setTheme({ termFontSize: next })
    })

    // Repaint xterm from its own buffer — fixes xterm-side render glitches WITHOUT changing the grid,
    // so it can never desync xterm's size from the remote (which would jumble a TUI like tmux).
    const repaint = () => term.refresh(0, term.rows - 1)

    // The dead-pane restart (phase1 M-3): a shell that exited on its own leaves the pane mounted
    // with its scrollback — a restart is a fresh PTY into the same xterm, re-issuing this pane's
    // own spawn with the LIVE grid and the pane's last known cwd. pty:spawn's dead-id path
    // re-registers trackers and spawns fresh (pty.has(id) is false after exit). LOCAL panes only:
    // a remote connection's id-reuse defense (0018 FINDING-004) refuses a re-seen pane id, so the
    // overlay never offers Restart on a remote pane.
    registerRespawner(paneId, () => {
      if (disposed || home) return
      useStore.getState().setExited(paneId, false)
      void api.ptySpawn({
        id: paneId, shellId: config.shellId,
        cwd: paneCwd(useStore.getState(), paneId) || config.cwd,
        cols: term.cols, rows: term.rows, launch: config.launch, envId: config.envId, workspaceId: wsId
      })
    })
    // Manual "Redraw terminal" (Ctrl+Shift+L): the aggressive path — re-fit + repaint xterm, a real
    // cross-tick SIGWINCH nudge, and a Ctrl+L to the program so a garbled TUI (Claude, tmux, …)
    // re-emits a clean frame. Logic + rationale live in the injectable `redraw()` so it's unit-tested.
    const redrawAction = () => redraw({
      fit: () => fit.fit(),
      repaint,
      dims: () => ({ cols: term.cols, rows: term.rows }),
      // Track the grid the PTY now holds (redraw's shrink→restore pair ends on the fitted grid), so a
      // later ResizeObserver fire doesn't read a stale baseline and issue a redundant resize.
      resize: ({ cols, rows }) => { gridRef.current = { cols, rows }; api.ptyResize({ id: paneId, cols, rows }) },
      write: (data) => api.ptyWrite({ id: paneId, data }),
      schedule: (fn) => setTimeout(fn, 0),
    })
    registerRedrawer(paneId, redrawAction)

    // Clickable links: Ctrl/Cmd+click a URL to open it, or an image (path/url) to preview it.
    // Local-path detection is off for SSH panes (the file lives on the remote).
    const linksDisposer = registerTerminalLinks(term, {
      isSsh: config.launch?.command === 'ssh',
      getCwd: () => paneCwd(useStore.getState(), paneId) || config.cwd,
      getHome: () => useStore.getState().home,
      openExternal: (url) => api.openExternal(url),
      openImage: (src) => useStore.getState().openImagePreview(src),
      // Source locations (src/foo.ts:42:8) open in the editor pane at that position. Stat-gated
      // at click time so a random `word:12` that isn't a real file stays a no-op.
      openFileAt: (path, line, col) => {
        void api.fsStat(path).then(st => {
          if (st.isDir) return
          stashReveal(path, { line, col })
          useStore.getState().openFileInEditor(wsId, path)
        }).catch(() => {})
      }
    })

    // Alt-screen one-shot repaint (rationale + the debounce mechanics in setupAltScreenRepaint).
    const offAltRepaint = setupAltScreenRepaint(term, { repaint })

    let settle: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      // Fits, then resizes the PTY only when the grid actually changed. A redundant resize makes
      // ConPTY repaint, which can corrupt the status tail and break needs-input detection.
      sync()
      // After the user stops dragging, repaint once so xterm rendering self-corrects. Repaint only —
      // the sync above already fit + resized the PTY; calling fit() again here without a matching
      // ptyResize could desync xterm's grid from the remote and jumble a TUI (e.g. tmux over ssh).
      if (settle) clearTimeout(settle)
      settle = setTimeout(repaint, RESIZE_SETTLE_MS)
    })
    ro.observe(host)

    return () => {
      // The pre-extraction teardown order, with each concern's lines grouped into its own dispose
      // (every grouped step is an independent listener/timer removal, so the grouping is inert).
      disposed = true
      clipboard.dispose()   // contextmenu
      offCopyOnSelect()     // mouseup
      offMiddlePaste()      // auxclick
      offDragDrop()         // dragover + drop
      pill.dispose()        // viewport scroll
      offWheelZoom()        // wheel (capture)
      unregisterSerializer(paneId)
      unregisterFocuser(paneId)
      unregisterRedrawer(paneId)
      unregisterRespawner(paneId)
      unregisterClearer(paneId)
      unregisterFindOpener(paneId)
      if (settle) clearTimeout(settle)
      autoResume.dispose()  // the resume quiet timer
      offAltRepaint()       // the alt timer + both parser subscriptions
      offBell()             // the bell flash timer + onBell
      titleDisp.dispose()
      linksDisposer.dispose()
      ro.disconnect(); inputDisp.dispose(); offData(); offExit(); term.dispose()
      termRef.current = null; fitRef.current = null; searchRef.current = null
    }
  // launch.args is an array; key the effect on a stable string of it (+ command) so an
  // SSH terminal re-spawns if its target changes, without re-running on unrelated renders.
  }, [paneId, config.shellId, config.cwd, config.launch?.command, JSON.stringify(config.launch?.args)])

  // Live-apply the scrollback setting to the running terminal (a shrink drops the oldest lines).
  const termScrollback = useStore(s => s.quick.termScrollback)
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.scrollback = termScrollback ?? DEFAULT_TERM_SCROLLBACK
  }, [termScrollback])

  const theme = useResolvedPaneTheme(wsId, config.theme)
  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    term.options.theme = { background: theme.termBg, foreground: theme.termFg }
    term.options.fontFamily = theme.termFontFamily
    term.options.fontSize = theme.termFontSize
    // A new font size means a new cell size, so this fit() RE-GRIDS xterm — and `fit()` resizes
    // xterm without anyone telling the PTY (nothing listens to term.onResize). Left unpaired, a
    // Ctrl+wheel zoom leaves the program drawing at the old width into a terminal of a new one:
    // garbled output that Ctrl+L can't fix, only a real resize (e.g. maximizing) can. So sync.
    syncGrid(gridDeps(term, fit, gridRef, paneId))
  }, [theme, paneId])

  // The host div keeps its exact box (layout-measuring specs read it; the ResizeObserver watches
  // it); the wrapper only provides the positioning context for the exited overlay, which is
  // absolutely positioned and can never change the terminal's geometry.
  const closeFind = () => {
    setFindOpen(false)
    searchRef.current?.clearDecorations()
    termRef.current?.focus()
  }
  const findNext = () => { const q = findInputRef.current?.value; if (q) searchRef.current?.findNext(q) }
  const findPrev = () => { const q = findInputRef.current?.value; if (q) searchRef.current?.findPrevious(q) }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }} className={bell ? 'term-bell-flash' : undefined}>
      <div data-testid={`terminal-${paneId}`} ref={hostRef} style={{ width: '100%', height: '100%' }} />
      {findOpen && (
        // In-pane find (QoL 2026-07-17): searches THIS terminal's buffer — distinct from the
        // cross-pane history search. Overlay only; never perturbs the terminal host's box.
        <div data-testid={`find-bar-${paneId}`}
          style={{ ...SURFACE, position: 'absolute', top: 4, right: 4, zIndex: 6,
            display: 'flex', gap: 4, padding: 4, alignItems: 'center', fontSize: 12 }}>
          <input ref={findInputRef} data-testid={`find-input-${paneId}`} autoFocus placeholder="Find…"
            onChange={e => { const q = e.target.value; if (q) searchRef.current?.findNext(q, { incremental: true }); else searchRef.current?.clearDecorations() }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) findPrev(); else findNext() }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind() }
            }}
            style={{ width: 160 }} />
          <button title="Previous match (Shift+Enter)" onClick={findPrev}>▲</button>
          <button title="Next match (Enter)" onClick={findNext}>▼</button>
          <button title="Close (Esc)" aria-label="Close find" onClick={closeFind}>✕</button>
        </div>
      )}
      {newOutput && (
        <button data-testid={`new-output-${paneId}`}
          onClick={() => { termRef.current?.scrollToBottom(); setNewOutput(false); termRef.current?.focus() }}
          style={{ ...SURFACE, position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)',
            zIndex: 5, padding: '2px 10px', borderRadius: 10, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          ▼ new output
        </button>
      )}
      {exited && (
        // The dead-pane affordance (phase1 M-3): the shell exited on its own; the pane keeps its
        // scrollback under this small overlay instead of sitting there with no next action.
        // Restart is local-only (a remote connection refuses a re-seen pane id — 0018 FINDING-004).
        <div data-testid={`exited-overlay-${paneId}`}
          style={{ ...SURFACE, position: 'absolute', left: '50%', bottom: 12, transform: 'translateX(-50%)',
            zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
            borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--fg-dim, #aaa)' }}>process exited</span>
          {!isRemote && (
            <button type="button" data-testid={`restart-${paneId}`}
              onClick={() => respawnPane(paneId)}>Restart</button>
          )}
          <button type="button" data-testid={`close-exited-${paneId}`}
            onClick={() => closePane(wsId, paneId)}>Close pane</button>
        </div>
      )}
    </div>
  )
}
