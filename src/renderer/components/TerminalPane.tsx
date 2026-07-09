import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api'
import type { TerminalConfig } from '@shared/types'
import { resolveTheme } from '@shared/theme'
import { nextFontSize } from '@shared/font-zoom'
import { matchShortcut, resolveBindings } from '@shared/keymap'
import { useStore, paneCwd } from '../store'
import { domainAllowed } from '../store/remote-gates'
import { useResolvedPaneTheme } from '../use-resolved-theme'
import { handleClipboardKey, normalizeCopiedText } from './terminal-clipboard'
import { registerSerializer, unregisterSerializer, consumeSnapshot, registerFocuser, unregisterFocuser, registerRedrawer, unregisterRedrawer, registerRespawner, unregisterRespawner, respawnPane } from './terminal-registry'
import { SURFACE } from './Modal'
import { redraw } from './redraw'
import { syncGrid, type GridSyncDeps } from './grid-sync'
import { shouldAutoResumeClaude } from '../store/pane-ops'
import { registerTerminalLinks } from '../terminal/links'

/** Scrollback lines captured when serializing a terminal for a window-handoff replay. */
const HANDOFF_SCROLLBACK_LINES = 1000

/** Quiet window after the last resize before we repaint xterm once, so a drag doesn't repaint per frame. */
const RESIZE_SETTLE_MS = 150

/** Output-quiet window after a restored shell's prompt before auto-typing `claude --resume`. */
const RESUME_QUIET_MS = 700

/** Output-quiet window after entering the alternate screen (tmux/TUI launch) before a one-shot repaint. */
const ALT_SCREEN_REFRESH_MS = 200

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
  const exited = useStore(s => !!s.exited[paneId])
  const isRemote = useStore(s => !!s.workspaces[wsId]?.home)
  const closePane = useStore(s => s.closePane)
  /** The grid the PTY was last told about. Shared by every `fit()` site (the ResizeObserver, the
   *  font/theme effect, the redraw command) so none of them can re-grid xterm without telling the
   *  PTY — an unpaired fit desyncs the two and renders garbled. See `grid-sync.ts`. */
  const gridRef = useRef({ cols: 0, rows: 0 })

  useEffect(() => {
    const t0 = resolveTheme(useStore.getState().quick.theme, useStore.getState().workspaces[wsId]?.theme, config.theme)
    const term = new Terminal({
      fontFamily: t0.termFontFamily, fontSize: t0.termFontSize, cursorBlink: true,
      theme: { background: t0.termBg, foreground: t0.termFg }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // Serialize the screen + scrollback to ANSI on demand, so this terminal's visible content can
    // be replayed into a new window when its workspace is torn off / re-docked (see WindowManager).
    const serialize = new SerializeAddon()
    term.loadAddon(serialize)
    registerSerializer(paneId, () => serialize.serialize({ scrollback: HANDOFF_SCROLLBACK_LINES }))
    // Report whether focus actually landed: term.focus() is a no-op while the pane is hidden
    // (e.g. its workspace is mid-switch), and requestPaneFocus retries until it sticks.
    registerFocuser(paneId, () => { term.focus(); return document.activeElement === term.textarea })
    termRef.current = term; fitRef.current = fit
    term.open(hostRef.current!)
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
      cols: term.cols, rows: term.rows, launch: config.launch, envId: config.envId,
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
    // spawn result (`adopted` = pty.has) knows it's a re-adoption there. `wantResume` stays false
    // until the spawn resolves; data arriving meanwhile just no-ops scheduleResume, and the kick
    // after resolution (re-armed by each later chunk) starts the quiet timer.
    let wantResume = false
    let resumeTimer: ReturnType<typeof setTimeout> | undefined
    let resumed = false
    const scheduleResume = () => {
      if (!wantResume || resumed) return
      if (resumeTimer) clearTimeout(resumeTimer)
      resumeTimer = setTimeout(() => { resumed = true; api.ptyWrite({ id: paneId, data: 'claude --resume\r' }) }, RESUME_QUIET_MS)
    }
    void spawned.then((adopted) => {
      if (disposed) return
      wantResume = shouldAutoResumeClaude({
        resumeAi: config.resumeAi,
        autoResumeEnabled: useStore.getState().quick.autoResumeClaude !== false,
        adoptedLivePty: !!adopted,
        consumedSnapshot: !!restored,
      })
      scheduleResume()
    })

    const offData = api.onPtyData((id, data) => { if (id === paneId) { term.write(data); scheduleResume() } })
    const offExit = api.onPtyExit((id) => { if (id === paneId && !disposed) term.write('\r\n[process exited]\r\n') })
    const inputDisp = term.onData(d => api.ptyWrite({ id: paneId, data: d }))

    // Clipboard: Ctrl+C copies a selection (else ^C falls through), Ctrl+V / right-click paste.
    // Paste goes through term.paste() so it honors bracketed-paste mode (multi-line pastes into a
    // shell or TUI don't auto-run); it flows out via the inputDisp onData handler above.
    const paste = async () => { const text = await api.clipboardRead(); if (text) term.paste(text) }
    // Clean up a terminal selection before it hits the clipboard (reflow TUI-wrapped lines, trim/
    // collapse blanks) unless the cleanCopy setting is off. Default on.
    const cleanSel = (s: string) =>
      useStore.getState().quick.cleanCopy === false ? s : normalizeCopiedText(s)
    term.attachCustomKeyEventHandler(e => {
      // Let app-global shortcuts (command palette, workspace switch, …) reach App's window-level
      // keydown handler instead of being consumed by the terminal. xterm otherwise swallows e.g.
      // Ctrl+K when a terminal is focused — which, now that new panes auto-focus, would be most of
      // the time. Returning false makes xterm ignore the key without preventing/stopping it, so the
      // original event still bubbles to window. Only keydown matches; keyup/press fall through.
      if (e.type === 'keydown' && matchShortcut(e, resolveBindings(useStore.getState().quick.keybindings))) return false
      // handleClipboardKey calls e.preventDefault() for copy/paste so the browser's native
      // copy/paste DOM event doesn't ALSO fire xterm's built-in handler (which double-pastes).
      return handleClipboardKey(e, term.hasSelection(), {
        copy: () => { api.clipboardWrite(cleanSel(term.getSelection())); term.clearSelection() },
        paste: () => { void paste() }
      })
    })
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); void paste() }
    hostRef.current!.addEventListener('contextmenu', onContextMenu)

    // Copy-on-select: the instant a selection gesture ends (mouseup after a drag or multi-click),
    // copy it to the clipboard — BEFORE incoming terminal output can clear the xterm selection out
    // from under a later Ctrl+C (in a live pane, e.g. Claude printing, that race is what made copy
    // "sometimes" fail). Ctrl+C stays as a manual copy/interrupt. The selection is left intact (not
    // cleared) so it stays visible and re-copyable. Gated by the copyOnSelect setting (default on).
    const onMouseUp = () => {
      if (useStore.getState().quick.copyOnSelect === false) return
      const sel = term.getSelection()
      if (sel) api.clipboardWrite(cleanSel(sel))
    }
    hostRef.current!.addEventListener('mouseup', onMouseUp)

    // Ctrl/Cmd + wheel zooms the terminal font (like editors/browsers). Capture phase + stop so
    // xterm doesn't also scroll the buffer; writes the global termFontSize, which the theme effect
    // below re-applies and re-fits across every terminal. passive:false so preventDefault sticks.
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault(); e.stopPropagation()
      const cur = term.options.fontSize ?? 13
      const next = nextFontSize(cur, e.deltaY)
      if (next !== cur) useStore.getState().setTheme({ termFontSize: next })
    }
    hostRef.current!.addEventListener('wheel', onWheel, { passive: false, capture: true })

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
        cols: term.cols, rows: term.rows, launch: config.launch, envId: config.envId
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
      openImage: (src) => useStore.getState().openImagePreview(src)
    })

    // tmux/vim/less… switch to the alternate screen when they launch; under xterm's DOM renderer that
    // first full-screen frame occasionally draws garbled (a known renderer miss that a repaint cures
    // — the same thing the manual Redraw does; subsequent frames are fine). So when we enter the
    // alternate buffer, repaint once after the initial draw settles. Over ssh the remote tmux isn't in
    // the local process tree, but the alt-screen switch IS in the byte stream xterm parses, so this
    // catches it. Re-arms on each alt entry (detach/reattach, another TUI); harmless no-op otherwise.
    let altPending = false
    let altTimer: ReturnType<typeof setTimeout> | undefined
    const bumpAlt = () => {
      if (!altPending) return
      if (altTimer) clearTimeout(altTimer)
      altTimer = setTimeout(() => { altPending = false; repaint() }, ALT_SCREEN_REFRESH_MS)
    }
    const offBufferChange = term.buffer.onBufferChange(b => {
      if (b.type === 'alternate') { altPending = true; bumpAlt() }
      else { altPending = false; if (altTimer) clearTimeout(altTimer) }
    })
    const offWriteParsed = term.onWriteParsed(() => bumpAlt())  // debounce the one-shot until output quiets

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
    ro.observe(hostRef.current!)

    return () => {
      disposed = true
      hostRef.current?.removeEventListener('contextmenu', onContextMenu)
      hostRef.current?.removeEventListener('mouseup', onMouseUp)
      hostRef.current?.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
      unregisterSerializer(paneId)
      unregisterFocuser(paneId)
      unregisterRedrawer(paneId)
      unregisterRespawner(paneId)
      if (settle) clearTimeout(settle)
      if (resumeTimer) clearTimeout(resumeTimer)
      if (altTimer) clearTimeout(altTimer)
      offBufferChange.dispose(); offWriteParsed.dispose()
      linksDisposer.dispose()
      ro.disconnect(); inputDisp.dispose(); offData(); offExit(); term.dispose()
      termRef.current = null; fitRef.current = null
    }
  // launch.args is an array; key the effect on a stable string of it (+ command) so an
  // SSH terminal re-spawns if its target changes, without re-running on unrelated renders.
  }, [paneId, config.shellId, config.cwd, config.launch?.command, JSON.stringify(config.launch?.args)])

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
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div data-testid={`terminal-${paneId}`} ref={hostRef} style={{ width: '100%', height: '100%' }} />
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
