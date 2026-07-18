import type { ShellInfo, Workspace, MosaicDirection, SplitDir4, AiSession, AiTool, TerminalStatus } from '@shared/types'
import { DEFAULT_THEME } from '@shared/theme'

export type PaneKind = 'terminal' | 'editor' | 'explorer' | 'orky'

/** The store actions `dispatchAddPane` needs, narrowed so the helper is api-free and unit-testable
 *  (the renderer `api` module touches `window`, so anything importing it can't run under vitest). */
export interface PaneActions {
  workspaces: Record<string, Workspace>
  addTerminal: (wsId: string, target: string | null, dir: MosaicDirection, splitDir?: SplitDir4) => unknown
  addEditor: (wsId: string, target: string | null, dir: MosaicDirection, splitDir?: SplitDir4) => unknown
  addExplorer: (wsId: string, target: string | null, dir: MosaicDirection, root: string, splitDir?: SplitDir4) => unknown
  addOrky: (wsId: string, target: string | null, dir: MosaicDirection, root: string, splitDir?: SplitDir4) => unknown
}

/** The shell a new terminal should use: the user's explicit pick, else the first detected shell,
 *  else cmd. Centralizes the fallback chain that was copy-pasted across every launch action. */
export function defaultShellId(s: { newTerminalShellId: string | null; shells: ShellInfo[] }): string {
  return s.newTerminalShellId ?? s.shells[0]?.id ?? 'cmd'
}

/** The pane that `launch`/open-in-first actions split off: the first existing pane, or null when
 *  the workspace is empty (then the caller creates the first pane). */
export function firstTarget(ws: Workspace): string | null {
  return ws.layout ? Object.keys(ws.panes)[0] : null
}

/** The pane a pane-scoped chord (Ctrl+Shift+M maximize / minimize) targets: the focused pane when
 *  it belongs to this workspace, else the workspace's first pane. `focusedPaneId` is only seeded
 *  on pane mouse-down, so before the first click in a workspace (fresh boot, tab switch) it is
 *  null or points into ANOTHER workspace — the chord used to be a silent no-op in both cases. */
export function chordPaneTarget(
  ws: Workspace | undefined, focusedPaneId: string | null
): string | null {
  if (!ws) return null
  if (focusedPaneId && ws.panes[focusedPaneId]) return focusedPaneId
  return firstTarget(ws)
}

/** The confirm prompt a pane close must show, or null when nothing is at risk (QoL batch
 *  2026-07-17: pane close used to kill a running build/AI session — and discard an editor's
 *  unsaved tabs plus their hot-exit drafts — with zero warning, while close-WORKSPACE confirmed).
 *  Pure so the at-risk decision + copy are unit-testable; store.closePane gates on it. */
export function paneCloseConfirmText(
  o: { kind: string; dirtyCount: number; foreground?: string; aiLabel?: string }
): string | null {
  if (o.kind === 'editor' && o.dirtyCount > 0) {
    const files = o.dirtyCount === 1 ? '1 file' : `${o.dirtyCount} files`
    return `This editor has ${files} with unsaved changes. Close the pane and discard them?`
  }
  if (o.kind === 'terminal') {
    const label = o.aiLabel ?? o.foreground
    if (label) return `This terminal is running ${label}. Close the pane and kill it?`
  }
  return null
}

/** How many of a workspace's terminal panes are actively running something (a foreground child
 *  process or an AI session) — the close-workspace confirm folds this in so an idle workspace's
 *  prompt reads differently from one about to kill a live build. Pure/api-free. */
export function busyPaneCount(
  ws: Workspace,
  procs: Record<string, { foreground?: string }>,
  aiSessions: Record<string, AiSession>
): number {
  return Object.keys(ws.panes).filter(id =>
    ws.panes[id].config.kind === 'terminal' && (procs[id]?.foreground || aiSessions[id])
  ).length
}

/** Add a pane of `kind` to `wsId`, splitting off its first existing pane. No-ops for a missing
 *  workspace; the explorer branch prompts for a folder first (and skips if cancelled), and the
 *  orky branch (feature 0009, REQ-004) prompts through its OWN injected, api-free root-picker
 *  callback — ONE callback per concept, no primary+override pair (CONV-006) — committing the
 *  picked root VERBATIM (REQ-005) and nothing at all on cancel. Centralizes the kind→action
 *  dispatch that was triplicated (and had drifted) across App, CommandPalette and WorkspaceTabs. */
export async function dispatchAddPane(
  s: PaneActions,
  wsId: string,
  kind: PaneKind,
  openFolder: () => Promise<string | null>,
  pickOrkyRoot?: () => Promise<string | null>
): Promise<void> {
  const ws = s.workspaces[wsId]
  if (!ws) return
  const target = firstTarget(ws)
  if (kind === 'terminal') s.addTerminal(wsId, target, 'row')
  else if (kind === 'editor') s.addEditor(wsId, target, 'row')
  else if (kind === 'orky') {
    const root = await pickOrkyRoot?.()
    if (root) s.addOrky(wsId, target, 'row', root)
  } else {
    const root = await openFolder()
    if (root) s.addExplorer(wsId, target, 'row', root)
  }
}

/** The store surface the shared command dispatcher below reads/drives, narrowed so the helper is
 *  api-free and unit-testable (the same reason PaneActions above exists). Both call sites pass
 *  `useStore.getState()`, which satisfies this structurally. */
export interface CommandActions {
  activeId: string | null
  focusedPaneId: string | null
  workspaces: Record<string, Workspace>
  minimized: Record<string, string[]>
  notesOpen: boolean
  addPaneOfKind: (wsId: string, kind: PaneKind) => unknown
  closePane: (wsId: string, paneId: string) => unknown
  toggleMaximize: (wsId: string, paneId: string) => unknown
  toggleMinimize: (wsId: string, paneId: string) => unknown
  restorePane: (wsId: string, paneId: string) => unknown
  setNotesOpen: (open: boolean) => unknown
  openSettings: (t: { section: 'general' }) => unknown
  setTheme: (patch: { termFontSize: number }) => unknown
}

/** The xterm-registry hooks the dispatcher needs, injected because terminal-registry lives beside
 *  components (keep this module import-clean for the node-env vitest harness). Callers pass
 *  `{ clearPane, redrawPane, openPaneFind }` from components/terminal-registry. */
export interface PaneRegistryFns {
  clearPane: (paneId: string) => unknown
  redrawPane: (paneId: string) => unknown
  openPaneFind: (paneId: string) => unknown
}

/** The ONE command→action dispatch shared by App.tsx's chord handler and CommandPalette's
 *  activate() (2026-07-17 audit Finding 28 — the two sites had ~12 commands kept in agreement
 *  only by convention). Returns true when `id` is a command this dispatcher owns (a pane-scoped
 *  command with no target is still `true`: handled as a deliberate no-op), false for anything
 *  else so callers can keep their own site-specific commands.
 *
 *  Deliberately NOT owned here (each pinned to its original call-site shape by a frozen suite,
 *  or genuinely site-specific): capture-orky-work (TEST-495 pins both sites), toggle-orky-queue
 *  (TEST-360 pins the App case, TEST-329 the palette literal), toggle-search vs the palette's
 *  search-history (toggle vs open — different semantics), toggle-broadcast vs broadcast (same),
 *  font-zoom-in/out + workspace navigation (chord-only), and the palette's creation/connection
 *  items.
 *
 *  `redrawTarget` carries the single GENUINE divergence between the two sites: the chord redraws
 *  exactly the focused pane (`focusedPaneId ?? ''`, even a stale cross-workspace id — 'focused'),
 *  while the palette redraws the chord target ('chord'). Parameterized, never homogenized. */
export function dispatchCommand(
  id: string,
  s: CommandActions,
  reg: PaneRegistryFns,
  opts: { redrawTarget: 'focused' | 'chord' }
): boolean {
  const activeId = s.activeId
  const paneTarget = (): string | null =>
    chordPaneTarget(activeId ? s.workspaces[activeId] : undefined, s.focusedPaneId)
  switch (id) {
    case 'new-terminal': {
      if (activeId) void s.addPaneOfKind(activeId, 'terminal')
      return true
    }
    case 'open-settings': s.openSettings({ section: 'general' }); return true
    case 'toggle-notes': s.setNotesOpen(!s.notesOpen); return true
    case 'font-zoom-reset': s.setTheme({ termFontSize: DEFAULT_THEME.termFontSize }); return true
    case 'toggle-maximize-pane': {
      const pane = paneTarget()
      if (pane && activeId) s.toggleMaximize(activeId, pane)
      return true
    }
    case 'toggle-minimize-pane': {
      const pane = paneTarget()
      if (pane && activeId) s.toggleMinimize(activeId, pane)
      return true
    }
    case 'close-pane': {
      const pane = paneTarget()
      if (pane && activeId) s.closePane(activeId, pane) // closePane owns the busy/dirty confirm
      return true
    }
    case 'restore-last-minimized': {
      if (!activeId) return true
      const ids = s.minimized[activeId] ?? []
      const last = ids[ids.length - 1]
      if (last) s.restorePane(activeId, last)
      return true
    }
    case 'clear-terminal': {
      const pane = paneTarget()
      if (pane) reg.clearPane(pane)
      return true
    }
    case 'find-in-terminal': {
      const pane = paneTarget()
      if (pane) reg.openPaneFind(pane)
      return true
    }
    case 'redraw-terminal': {
      if (opts.redrawTarget === 'focused') reg.redrawPane(s.focusedPaneId ?? '')
      else {
        const pane = paneTarget()
        if (pane) reg.redrawPane(pane)
      }
      return true
    }
  }
  return false
}

/** Fold the live AI-session map into terminal pane configs at save time: a pane currently running
 *  an AI tool (e.g. Claude) gets `resumeAi` stamped so it can auto-resume on the next launch; a pane
 *  that no longer runs one has any stale `resumeAi` cleared. Pure; returns the same ws when unchanged
 *  so it never forces a needless write. Mirrors applyCwds (kept here, api-free, so it's testable). */
export function applyResumeAi(ws: Workspace, aiSessions: Record<string, AiSession>): Workspace {
  let changed = false
  const panes = { ...ws.panes }
  for (const id of Object.keys(panes)) {
    const pane = panes[id]
    if (pane.config.kind !== 'terminal') continue
    const next = aiSessions[id]?.tool
    if (pane.config.resumeAi !== next) {
      panes[id] = { ...pane, config: { ...pane.config, resumeAi: next } }
      changed = true
    }
  }
  return changed ? { ...ws, panes } : ws
}

/** Whether a freshly-mounted terminal pane should auto-type `claude --resume`. TRUE only for a
 *  genuinely fresh shell spawn of a pane that had Claude at last save (`resumeAi === 'claude'`) with
 *  the setting on. MUST be FALSE for a re-adoption of a still-running PTY — minimize/restore, a
 *  same-window cross-workspace move, or a multi-window handoff — because Claude is still alive there
 *  and the command would land as a prompt into the live agent (the restore-types-`claude --resume`
 *  bug). Either re-adoption signal alone vetoes the resume:
 *  - `adoptedLivePty`: main's authoritative answer from the idempotent `pty:spawn` (`pty.has`). The
 *    ONLY signal present in the destination window of a multi-window undock/re-dock — there the
 *    scrollback snapshot rides main's transit buffer (delivered as `pty:data`), so the renderer
 *    stash below is empty. Gating on the stash alone typed `claude --resume` into the live agent
 *    on every undock of a Claude pane.
 *  - `consumedSnapshot`: a renderer-stashed scrollback snapshot was consumed on this mount
 *    (same-window move / minimize-restore; also keeps the historical don't-resume behavior when the
 *    pty died while stashed). Pure + api-free. */
export function shouldAutoResumeClaude(
  o: { resumeAi?: AiTool; autoResumeEnabled: boolean; adoptedLivePty: boolean; consumedSnapshot: boolean }
): boolean {
  return o.resumeAi === 'claude' && o.autoResumeEnabled && !o.adoptedLivePty && !o.consumedSnapshot
}

/** Display state for an AI session pane: 'working' when busy, 'awaiting' when quiet, null if not
 *  an AI session. */
export function aiState(
  s: { aiSessions: Record<string, AiSession>; statuses: Record<string, TerminalStatus> },
  paneId: string
): 'working' | 'awaiting' | null {
  if (!s.aiSessions[paneId]) return null
  return s.statuses[paneId]?.state === 'busy' ? 'working' : 'awaiting'
}

/** The workspace-close teardown routing core (feature 0024, REQ-019 / locked D10 / FINDING-023):
 *  a REMOTE workspace close must DETACH — never `pty:kill` any of its panes, over the wire or
 *  locally — so the daemon and its PTYs survive for the F18 reattach, exactly like the quit-app
 *  and banner-disconnect gestures. A LOCAL workspace close stays byte-identical to today: one
 *  kill per pane, in order, no detach. Pure and api-free (the repo's renderer-injection
 *  convention) — `store.ts`'s `closeWorkspace` supplies the actual kill/detach closures. */
export function routeWorkspaceTeardown(
  input: { isRemote: boolean; paneIds: string[] },
  fns: { kill: (paneId: string) => void; detach: () => void }
): void {
  if (input.isRemote) {
    fns.detach()
    return
  }
  for (const paneId of input.paneIds) fns.kill(paneId)
}
