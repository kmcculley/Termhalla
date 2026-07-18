import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { Workspace, PaneConfig, EditorConfig, MosaicDirection, SplitDir4 } from '@shared/types'
import { EMPTY_QUICK } from '@shared/types'
import { createWorkspace, removePane, reorderIds, movePane, carryTheme, splitDirToLayout, restorePane as restorePaneModel, workspaceFromTemplate, serializeWorkspace } from '@shared/workspace-model'
import { importWorkspaceDoc } from '@shared/workspace-doc'
import { orkyCockpitTemplate } from '@shared/orky-cockpit'
import { sameProjectRoot } from '@shared/orky-pane'
import { encodeBroadcast, terminalPaneIds } from '@shared/broadcast'
import { schedulesWithout } from '@shared/schedule'
import { api } from './api'
import type { State, SliceDeps } from './store/types'
import { makeRegisterWorkspace } from './store/workspace-registration'
import { removeFromMinimized, deriveViewStateInto } from './store/view-state'
import { makeSaveOutcome } from './store/save-outcome'
import {
  placePane, firstTarget, paneCwd, applyCwds, applyResumeAi, applyViewState, clearPaneRuntime, teardownPanes
} from './store/internals'
import { defaultShellId, dispatchAddPane, routeWorkspaceTeardown, paneCloseConfirmText } from './store/pane-ops'
import { readPaneSnapshot, stashSnapshot, requestPaneFocus, paneDirtyCount } from './components/terminal-registry'
import { readExplorerState, stashExplorerState } from './components/explorer-registry'
import { beginPaneTransit } from './components/pane-transit'
import { AUTOSAVE_DEBOUNCE_MS } from './timing'
import { createThemeSlice } from './store/theme-slice'
import { createRuntimeSlice } from './store/runtime-slice'
import { createQuickSlice } from './store/quick-slice'
import { createScheduleSlice } from './store/schedule-slice'
import { createRunCommandsSlice } from './store/run-commands-slice'
import { createToastsSlice } from './store/toasts-slice'
import { createSettingsSlice } from './store/settings-slice'
import { createKeybindingsSlice } from './store/keybindings-slice'
import { createNotesSlice } from './store/notes-slice'
import { createWorkspaceDocsSlice } from './store/workspace-docs-slice'
import { createSearchSlice } from './store/search-slice'
import { createPreviewSlice } from './store/preview-slice'
import { createRegistrySlice } from './store/registry-slice'
import { createOrkyPaneSlice } from './store/orky-pane-slice'
import { createOrkyCaptureSlice } from './store/orky-capture-slice'
import { createRemoteSlice } from './store/remote-slice'
import { paneMoveRefusalReason } from '@shared/remote-home'
import { caseFoldFromPlatform } from '@shared/decision-queue'

// Re-exported so existing `import { ... } from '../store'` call sites keep working.
export type { ThemeScope } from './store/types'
export { paneCwd, resolvedPaneTheme, aiState } from './store/internals'

/** A debounced action with an immediate flush (used for the autosave / quick-save timers). */
function makeDebounce(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    schedule: () => { if (timer) clearTimeout(timer); timer = setTimeout(fn, ms) },
    flush: () => { if (timer) { clearTimeout(timer); timer = null } fn() },
    cancel: () => { if (timer) { clearTimeout(timer); timer = null } }
  }
}

export const useStore = create<State>((set, get) => {
  // Every debounced writer routes its settle through a save-outcome gate (2026-07-17 audit,
  // Finding 6): a failed disk write used to be `void`ed away silently. One error toast per
  // failure streak (errors always render per the toast policy); a success re-arms the gate.
  const pushError = (text: string) => { get().pushToast(text, 'error') }
  const autosaveOutcome = makeSaveOutcome(
    d => `Saving workspaces failed — recent layout/cwd changes are not on disk yet (retries on the next change): ${d}`, pushError)
  const quickOutcome = makeSaveOutcome(
    d => `Saving settings/favorites failed — recent changes are not on disk yet (retries on the next change): ${d}`, pushError)
  const notesOutcome = makeSaveOutcome(
    d => `Saving notes failed — your edits are kept in memory and retry on the next notepad change: ${d}`, pushError)
  const autosave = makeDebounce(() => {
    get().saveAll().then(() => autosaveOutcome.succeeded(), e => autosaveOutcome.failed(e))
  }, AUTOSAVE_DEBOUNCE_MS)
  const quickSave = makeDebounce(() => {
    api.saveQuick(get().quick).then(() => quickOutcome.succeeded(), e => quickOutcome.failed(e))
  }, AUTOSAVE_DEBOUNCE_MS)
  const dirtyNotes = new Set<string>()
  const notesSave = makeDebounce(() => {
    const s = get()
    for (const k of [...dirtyNotes]) {
      const written = s.notes[k] ?? ''
      api.notesSet(k, written).then(
        () => {
          // Un-dirty the key only when the text that LANDED is still current — an edit racing the
          // in-flight write keeps it dirty so the next flush retries with the newer text. A failed
          // write also keeps it (the finally-cleared Set used to drop failed notes forever).
          if ((get().notes[k] ?? '') === written) dirtyNotes.delete(k)
          notesOutcome.succeeded()
        },
        e => notesOutcome.failed(e)
      )
    }
  }, AUTOSAVE_DEBOUNCE_MS)
  const scheduleAutosave = autosave.schedule
  const scheduleQuickSave = quickSave.schedule
  const scheduleNotesSave = (key: string) => { dirtyNotes.add(key); notesSave.schedule() }

  /** Focus a pane AND record it as the store's focused pane. Every programmatic focus must keep
   *  `focusedPaneId` in sync: the pane-scoped chords (maximize/minimize) and refocusActivePane
   *  all target `focusedPaneId`, and it is otherwise seeded only by a tile-body mouse-down — so a
   *  create/restore/move that focused the pane without tracking it left the chords aimed at the
   *  PREVIOUS pane (the stale-focus class pane-reveal.ts already solved; this is that pattern,
   *  shared). */
  const focusPaneTracked = (paneId: string) => {
    get().setFocusedPane(paneId)
    requestPaneFocus(paneId)
  }

  /** Place `cfg` as a new pane in `wsId`, commit it to state, schedule a save, and return the
   *  new pane id. Centralizes the get-ws / placePane / set-workspaces / autosave sequence that
   *  was copy-pasted across every "open a pane" action (and unifies their persistence on the
   *  debounced autosave rather than a mix of immediate saveAll and scheduleAutosave). A compass
   *  `splitDir` fully determines direction AND position, overriding `dir`/`position` — that
   *  derivation used to be copy-pasted across the four add* actions (2026-07-17 audit, F26). */
  const commitPane = (wsId: string, cfg: PaneConfig, opts: {
    target: string | null; dir: MosaicDirection; splitDir?: SplitDir4
    position?: 'before' | 'after'; markEditor?: boolean
  }): string => {
    const ws = get().workspaces[wsId]
    const lay = opts.splitDir
      ? splitDirToLayout(opts.splitDir)
      : { direction: opts.dir, position: opts.position ?? ('after' as const) }
    const r = placePane(ws, cfg, opts.target, lay.direction, lay.position)
    set(s => {
      const maximized = { ...s.maximized }
      delete maximized[wsId]
      return opts.markEditor
        ? { workspaces: { ...s.workspaces, [wsId]: r.workspace }, maximized, lastEditorPaneId: r.paneId }
        : { workspaces: { ...s.workspaces, [wsId]: r.workspace }, maximized }
    })
    scheduleAutosave()
    // Focus the pane the user just opened so they can type immediately. It mounts after this
    // commit, so requestPaneFocus retries until its focuser registers (see terminal-registry).
    focusPaneTracked(r.paneId)
    return r.paneId
  }

  /** Tell main this window's workspace list / active tab changed (add, close, reorder, switch), so
   *  main's authoritative windows[] arrangement stays in sync. NOT called from applyAssignment —
   *  that applies a main-pushed state, and reporting it back would echo. */
  const reportAssignment = () => {
    const s = get()
    if (!s.windowId) return
    api.winReport({ windowId: s.windowId, workspaceIds: s.order, activeId: s.activeId })
  }

  /** The ONE workspace-registration ritual (2026-07-06 audit, Group C #8): add the record to this
   *  window (append to order, make active), derive its persisted view-state into the runtime maps,
   *  schedule the autosave, and report the arrangement into main's authoritative windows[]. Every
   *  workspace-adding action routes through this — omitting the report shipped a real data-loss
   *  bug once (0011 FINDING-001). */
  const registerWorkspace = makeRegisterWorkspace({ set, scheduleAutosave, reportAssignment })

  /** Add a fully-formed workspace record to this window (registerWorkspace above) and land focus in
   *  its first pane. The panes mount on the next commit and spawn fresh PTYs (relaunching at cwd,
   *  reconnecting SSH, re-running `claude --resume`). Shared by openWorkspaceFromFile and
   *  reopenClosedWorkspace. */
  const adoptWorkspace = (ws: Workspace): void => {
    registerWorkspace(ws)
    const target = firstTarget(ws)
    if (target) focusPaneTracked(target)
  }

  /** The active workspace record with live cwd / AI-resume / view-state folded in — the exact
   *  serialized form `saveAll` writes internally, reused to write a `.thws` document. */
  const currentRecord = (wsId: string): Workspace => {
    const s = get()
    return applyViewState(applyResumeAi(applyCwds(s.workspaces[wsId], s.cwds), s.aiSessions), s.minimized[wsId], s.maximized[wsId])
  }
  const deps: SliceDeps = { set, get, scheduleAutosave, scheduleQuickSave, scheduleNotesSave, commitPane, registerWorkspace, currentRecord, adoptWorkspace }

  // Monotonic assignment generation (2026-07-17 audit, Finding 4). App.tsx wires
  // api.onWinAssignment unserialized, so assignment A's loadWorkspace await can settle AFTER
  // assignment B already committed; A's commit would then compute from A's stale workspaceIds and
  // delete B's newly-added workspace (clearing its panes' runtime) with no correcting push.
  // Captured at issue time, re-checked after the await — the registry slice's applyRecoveryPull
  // arbitration pattern. Newest assignment always wins.
  let assignmentGeneration = 0

  // Monotonic focus-sequence counter for paneFocusSeq (feature 0006, REQ-009): session-scoped
  // recency for the decision queue's click-to-focus MRU pick. Never persisted.
  let paneFocusCounter = 0

  // The pending OrkyRootPicker request's resolver (feature 0009, REQ-004): held in closure (a
  // function is not renderable state); orkyRootPickOpen mirrors it for the App-level chrome mount.
  let orkyRootPickResolve: ((root: string | null) => void) | null = null

  // The F11-owned one-shot cockpit picker request's resolver (feature 0011, REQ-003) — the
  // pickOrkyRoot pattern, deliberately a SEPARATE request so the F9 picker stays default-labelled
  // for its three existing callers; orkyCockpitPickOpen mirrors it for the App-level mount.
  let orkyCockpitPickResolve: ((root: string | null) => void) | null = null

  // Fold mode for the cockpit's pre-selected-root membership matching (feature 0011, REQ-004):
  // derived ONCE at composition from the one platform signal available in the contextIsolated
  // main world (the TEST-432 discipline — never a `process` read on the renderer path).
  const cockpitCaseFold = caseFoldFromPlatform(navigator.platform)

  return {
    // ---- initial state ----
    shells: [],
    workspaces: {},
    order: [],
    activeId: null,
    windowId: null,
    isMainWindow: true,   // true until a win:assignment says otherwise, so the first paint shows tabs
    newTerminalShellId: null,
    lastEditorPaneId: null,
    maximized: {},
    minimized: {},
    focusedPaneId: null,
    statuses: {},
    cwds: {},
    procs: {},
    gitStatus: {},
    aiSessions: {},
    usage: {},
    orky: {},
    recording: {},
    exited: {},
    oscTitles: {},
    editorDirty: {},
    drafts: {},
    notes: {},
    notesOpen: false,
    notesProjectKey: null,
    // Decision queue (feature 0006): runtime-only; the drawer always starts closed (REQ-017).
    registrySnapshot: null,
    registryError: null,
    queueOpen: false,
    snapshotGeneration: 0,
    // Native OrkyPane (feature 0009): runtime-only detail state + the shared root-picker request.
    orkyPaneDetail: {},
    orkyRootPickOpen: false,
    // Per-project Orky cockpit workspace (feature 0011): the F11-owned picker request flag.
    orkyCockpitPickOpen: false,
    // Remote workspaces (feature 0022): connection states + named-agent mirror + picker flag.
    remoteStates: {},
    namedAgents: [],
    remoteAgentPickerOpen: false,
    paneFocusSeq: {},
    cloud: [],
    envVault: { exists: false, unlocked: false },
    schedules: {},
    quick: EMPTY_QUICK,
    home: '',
    paletteOpen: false,
    broadcastOpen: false,
    connectionFormFor: null,
    searchOpen: false,

    // ---- domain slices ----
    ...createThemeSlice(deps),
    ...createRuntimeSlice(deps),
    ...createQuickSlice(deps),
    ...createScheduleSlice(deps),
    ...createRunCommandsSlice(deps),
    ...createToastsSlice(deps),
    ...createSettingsSlice(deps),
    ...createKeybindingsSlice(deps),
    ...createNotesSlice(deps),
    // Workspace documents (File menu) — extracted from the store root (2026-07-17 audit, F10a);
    // owns docPaths/reopenOpen + the save/open/reopen/delete `.thws` actions.
    ...createWorkspaceDocsSlice(deps),
    ...createSearchSlice(deps),
    ...createPreviewSlice(deps),
    ...createRegistrySlice(deps),
    // Quick-capture request slice (feature 0012): the openOrkyCapture(root?)/closeOrkyCapture
    // entry points the chord/palette path (and later F10's pane "inject") share.
    ...createOrkyCaptureSlice(deps),
    // Native OrkyPane detail slice (feature 0009): the preload bridge and the fold mode are
    // INJECTED here — the fold is derived ONCE via caseFoldFromPlatform(navigator.platform), the
    // one platform signal that exists in the contextIsolated main world (REQ-005 / FINDING-003).
    // Remote workspaces (feature 0022): the preload bridge is INJECTED (op.ts pattern) so the
    // slice's pure logic tests under the node harness; the toast chokepoint is the store's own.
    ...createRemoteSlice({
      set, get,
      remoteCurrent: () => api.remoteCurrent(),
      remoteConnect: (wsId, agentId) => api.remoteConnect(wsId, agentId),
      remoteDisconnect: (wsId) => api.remoteDisconnect(wsId),
      remoteAgentsList: () => api.remoteAgentsList(),
      remoteAgentsSave: (agents) => api.remoteAgentsSave(agents),
      pushToast: (text, kind) => get().pushToast(text, kind),
      // FINDING-006: only the window hosting the workspace (= the one rendering its banner)
      // toasts a disconnect; other windows ingest the broadcast state silently.
      hostsWorkspace: (wsId) => !!get().workspaces[wsId]
    }),
    ...createOrkyPaneSlice({
      set,
      get,
      registryDetail: (root) => api.registryDetail(root),
      caseFold: caseFoldFromPlatform(navigator.platform),
      updatePaneConfig: (wsId, paneId, patch) => get().updatePaneConfig(wsId, paneId, patch)
    }),

    // ---- core: bootstrap + persistence ----
    init: async () => {
      const shells = await api.listShells()
      set({ shells, newTerminalShellId: shells[0]?.id ?? null })
      const [quick, home, drafts, notes, docPaths] = await Promise.all([api.loadQuick(), api.homeDir(), api.draftsLoad(), api.notesLoad(), api.loadWorkspaceDocPaths()])
      set({ quick, home, drafts, notes, docPaths })
      // Workspaces are hydrated by applyAssignment when main pushes this window's win:assignment.
    },

    /** Apply the set of workspaces main says this window hosts: load any not yet in memory, drop
     *  any this window no longer owns (moved away), and set the active tab. The main window seeds a
     *  starter workspace when it has none (cold first run); a floating window never re-seeds (it
     *  legitimately closes itself when emptied). */
    applyAssignment: async ({ windowId, isMain, workspaceIds, activeId }) => {
      const gen = ++assignmentGeneration
      set({ windowId, isMainWindow: isMain })
      const missing = workspaceIds.filter(id => !get().workspaces[id])
      const loaded = await Promise.all(missing.map(id => api.loadWorkspace(id)))
      // A newer applyAssignment started while our loads were in flight: abandon this commit AND
      // the trailing main-window seed — committing from stale workspaceIds would delete
      // workspaces the newer assignment just added (Finding 4; see assignmentGeneration above).
      if (gen !== assignmentGeneration) return
      set(s => {
        const workspaces = { ...s.workspaces }
        for (const ws of loaded) if (ws) workspaces[ws.id] = ws
        // Panes departing with a moved-away workspace go through the SAME per-pane runtime cleanup
        // closePane/closeWorkspace use (clearPaneRuntime — CONV-011/FINDING-017): without it, every
        // runtime map (statuses/cwds/.../paneFocusSeq) leaked entries for panes this window no
        // longer hosts, and a redocked workspace inherited stale pre-departure focus ranks.
        const departedPaneIds: string[] = []
        for (const id of Object.keys(workspaces)) {
          if (!workspaceIds.includes(id)) {
            departedPaneIds.push(...Object.keys(workspaces[id].panes))
            delete workspaces[id]
          }
        }
        const order = workspaceIds.filter(id => workspaces[id])
        // Derive the per-ws view-state maps from each workspace's persisted record (REQ-007/008),
        // seeding only newly loaded ones so an existing window's live maps aren't clobbered.
        // The ONE shared derive (view-state.ts) — registerWorkspacePatch folds through the same
        // helper, so the two sites can never drift again (2026-07-17 audit, Finding 25).
        const minimized = { ...s.minimized }, maximized = { ...s.maximized }
        for (const ws of loaded) if (ws) deriveViewStateInto(minimized, maximized, ws)
        for (const id of Object.keys(minimized)) if (!workspaces[id]) delete minimized[id]
        for (const id of Object.keys(maximized)) if (!workspaces[id]) delete maximized[id]
        return {
          workspaces, order, minimized, maximized,
          activeId: order.length ? (activeId ?? order[0]) : null,
          // Spread only when something departed, so a no-drop assignment keeps every runtime-map
          // reference (no spurious subscriber re-renders on routine win:assignment pushes).
          ...(departedPaneIds.length ? clearPaneRuntime(s, departedPaneIds) : {})
        }
      })
      if (isMain && get().order.length === 0) get().newWorkspace('Workspace 1')
    },

    /** Answer main's serialize request: one snapshot per terminal pane, then a `__end__` sentinel.
     *  The serialize request precedes an undock/redock handoff in which the DESTINATION window loads
     *  this workspace's record from disk (applyAssignment → loadWorkspace). The view-state only reaches
     *  disk via the 500 ms debounced autosave, so a minimize-then-undock within that window would hand
     *  off a STALE (un-minimized) record (FINDING-DA-004). Flush + AWAIT the workspace save before the
     *  end sentinel (which resolves main's capture and triggers the destination load), so the handoff
     *  never rides the debounce timer. CONV: a cross-window/process handoff that re-reads persisted
     *  state MUST flush the relevant pending debounced save first. */
    serializeWorkspace: (wsId) => {
      const ws = get().workspaces[wsId]
      if (ws) {
        for (const paneId of Object.keys(ws.panes)) {
          if (ws.panes[paneId].config.kind !== 'terminal') continue
          api.termSnapshot({ paneId, data: readPaneSnapshot(paneId) })
        }
      }
      autosave.cancel()
      // Failure rides the same autosave outcome gate as the debounced writer (Finding 6); the
      // end sentinel must fire either way so main's capture always resolves.
      void get().saveAll()
        .then(() => autosaveOutcome.succeeded(), e => autosaveOutcome.failed(e))
        .finally(() => api.termSnapshot({ paneId: `__end__:${wsId}`, data: '' }))
    },

    saveAll: async () => {
      const { order, workspaces, cwds, aiSessions, minimized, maximized } = get()
      await Promise.all(order.map(id =>
        api.saveWorkspace(applyViewState(applyResumeAi(applyCwds(workspaces[id], cwds), aiSessions), minimized[id], maximized[id]))))
      // The windows[] arrangement (which window hosts which workspace) is persisted by main's
      // WindowManager, kept in sync via win:report — the renderer only owns workspace files now.
    },

    loadQuick: async () => {
      const [quick, home] = await Promise.all([api.loadQuick(), api.homeDir()])
      set({ quick, home })
    },

    // Keep the renderer's drafts map in lockstep with the on-disk draft store. `init` seeds it once
    // via draftsLoad; without these mirrors an in-session draft write/delete (e.g. flushed during a
    // pane transit — minimize/restore or a cross-workspace move) would not be visible to the pane's
    // remount, which reads `useStore.getState().drafts` in `openTab`, and the unsaved edits would be
    // lost (C3). These only update local state — the disk write still goes through api.draftsSet/Delete.
    setDraft: (key, draft) => set(s => ({ drafts: { ...s.drafts, [key]: draft } })),
    deleteDraft: (key) => set(s => { const drafts = { ...s.drafts }; delete drafts[key]; return { drafts } }),

    flushQuick: quickSave.flush,
    flushNotes: notesSave.flush,
    setNewTerminalShell: (id) => set({ newTerminalShellId: id }),

    // ---- core: workspace management ----
    newWorkspace: (name) => {
      const ws = createWorkspace(name, uuid)
      registerWorkspace(ws)
      return ws.id
    },

    /** Per-project Orky cockpit workspace (feature 0011, REQ-002/REQ-003/REQ-004): open a fresh
     *  workspace holding an Orky pane bound to a tracked project + a plain terminal at that root.
     *  No argument → the F11-labelled shared picker resolves the root (cancel creates nothing).
     *  With an argument → the picker is skipped; the root is membership-validated against the
     *  HELD registry snapshot via the fold-injected shared equality and the cockpit is built from
     *  the AGGREGATE MEMBER's spelling (case/slash-variant callers converge). Instantiation rides
     *  the ONE shipped template seam (fresh pane ids + F9's malformed-binding coercion, CONV-026);
     *  registration matches newWorkspace above IN FULL — including the load-bearing arrangement
     *  report (FINDING-001: an unreported workspace is silently deleted by the next pushed
     *  assignment and lost across quit→relaunch). Refusal/cancel paths create and report NOTHING.
     *  The success tail LANDS keyboard focus in the new cockpit's terminal (FINDING-007). */
    newOrkyWorkspace: async (root) => {
      let target: string
      if (root === undefined) {
        const picked = await new Promise<string | null>((resolvePick) => {
          orkyCockpitPickResolve?.(null)
          orkyCockpitPickResolve = resolvePick
          set({ orkyCockpitPickOpen: true })
        })
        if (picked === null) return null
        target = picked // the shared picker lists only held members, in the aggregate's spelling
      } else {
        const s = get()
        if (s.registrySnapshot === null) {
          // Membership is UNKNOWN, not absent — never the not-tracked copy (REQ-004/FINDING-003).
          if (s.registryError !== null) {
            get().pushToast(`Orky registry failed — project membership cannot be verified: ${s.registryError}`, 'error')
          } else {
            get().pushToast('The Orky registry snapshot is still loading — try the cockpit again once tracked projects arrive.', 'error')
          }
          return null
        }
        const member = s.registrySnapshot
          .map(e => (e && typeof e.root === 'string' ? e.root : ''))
          .find(m => m.length > 0 && sameProjectRoot(root, m, { caseFold: cockpitCaseFold }))
        if (member === undefined) {
          get().pushToast(`${root} is not tracked by Orky — open a terminal inside a project containing a .orky/ directory to track it, then retry.`, 'error')
          return null
        }
        target = member // the tracked spelling, never the caller's variant (REQ-004)
      }
      const tpl = orkyCockpitTemplate({ root: target, shellId: defaultShellId(get()) })
      const ws = workspaceFromTemplate(tpl, uuid(), tpl.name, uuid)
      registerWorkspace(ws)
      // FINDING-007 (ESC-001 loopback): the explicit cockpit gesture LANDS keyboard focus in the
      // created workspace — the precedent every pane-opening action sets (each ends in a
      // requestPaneFocus so the user can type immediately); CONV-046 sanctions gesture-mounted
      // focus (it bans focus-on-mount only for DATA-DRIVEN remounts). Without this, the picker-mediated
      // gestures strand a keyboard user on <body>: the invoking chrome (palette / templates menu)
      // unmounts in the same batched commit that mounts the picker, so the picker's CONV-020
      // restore has only <body> to collapse back onto and the next keystrokes are silently
      // swallowed. Target the cockpit's TERMINAL pane: it is the ready-to-type half (D4's plain
      // shell at the project root) and the only cockpit pane kind that registers a focuser (the
      // orky pane registers none, so a request aimed at it could never land — see
      // terminal-registry); requestPaneFocus retries until the pane's focuser registers post-mount.
      const termPaneId = Object.keys(ws.panes).find(id => ws.panes[id].config.kind === 'terminal')
      if (termPaneId) focusPaneTracked(termPaneId)
      return ws.id
    },

    resolveOrkyCockpitPick: (root) => {
      const resolvePick = orkyCockpitPickResolve
      orkyCockpitPickResolve = null
      set({ orkyCockpitPickOpen: false })
      resolvePick?.(root)
    },

    /** New remote workspace (feature 0022, REQ-015): no argument opens the agent picker (which
     *  re-invokes with the chosen id); with an agentId it creates a fresh workspace HOMED to that
     *  named agent holding ONE terminal pane at the agent home dir (cwd '' — never a local path).
     *  Registration matches newWorkspace IN FULL including the load-bearing arrangement report
     *  (0011 FINDING-001: an unreported workspace is silently dropped by the next pushed
     *  assignment). The gesture LANDS keyboard focus in the new terminal (CONV-055). */
    newRemoteWorkspace: async (agentId) => {
      if (agentId === undefined) {
        if (get().namedAgents.length === 0) void get().loadNamedAgents()
        set({ remoteAgentPickerOpen: true })
        return null
      }
      let agent = get().namedAgents.find(a => a.id === agentId)
      if (!agent) {
        await get().loadNamedAgents()
        agent = get().namedAgents.find(a => a.id === agentId)
      }
      if (!agent) {
        get().pushToast(`No named agent with id "${agentId}" exists — add it in the remote-agent picker first.`, 'error')
        return null
      }
      const ws = createWorkspace(agent.name, uuid)
      const paneId = uuid()
      ws.home = { kind: 'agent', agentId: agent.id, agentName: agent.name }
      ws.panes = { [paneId]: { paneId, config: { kind: 'terminal', shellId: defaultShellId(get()), cwd: '' } } }
      ws.layout = paneId
      registerWorkspace(ws)
      focusPaneTracked(paneId)
      return ws.id
    },
    closeRemoteAgentPicker: () => set({ remoteAgentPickerOpen: false }),

    renameWorkspace: (id, name) => {
      const n = name.trim()
      if (!n) return
      set(s => s.workspaces[id] ? { workspaces: { ...s.workspaces, [id]: { ...s.workspaces[id], name: n } } } : {})
      scheduleAutosave()
    },

    /** Duplicate a workspace (QoL 2026-07-17): a fresh-id deep copy of its CURRENT record (live
     *  cwds/view-state folded in) via the workspace-doc round trip, so pane ids re-map and the
     *  copy's panes spawn their own PTYs at the same cwds. Registered + focused like any adopt. */
    duplicateWorkspace: (id) => {
      const src = get().workspaces[id]
      if (!src) return null
      const copy = importWorkspaceDoc(serializeWorkspace(currentRecord(id)), uuid(), uuid)
      copy.name = `${src.name} (copy)`
      adoptWorkspace(copy)
      return copy.id
    },

    closeWorkspace: (id) => {
      const ws = get().workspaces[id]
      if (!ws) return
      const paneIds = Object.keys(ws.panes)
      // FINDING-023 (locked D10, REQ-019): a REMOTE workspace close DETACHES — never `pty:kill`s
      // its panes — so the daemon + PTYs survive for reattach, exactly like quit-app and banner
      // disconnect. A LOCAL workspace close stays byte-identical to today (one kill per pane).
      // routeWorkspaceTeardown centralizes the branch; the manager forgets the entry via the
      // additive `{ forget: true }` (detach-then-forget — no ghost in remote:current, CONV-011).
      routeWorkspaceTeardown(
        { isRemote: !!ws.home, paneIds },
        {
          kill: (paneId) => teardownPanes([paneId]),
          detach: () => {
            get().disconnectRemote(id, { forget: true })
            get().pruneRemoteStates(Object.keys(get().remoteStates).filter(wsId => wsId !== id))
          }
        }
      )
      set(s => {
        const workspaces = { ...s.workspaces }; delete workspaces[id]
        const order = s.order.filter(x => x !== id)
        const activeId = s.activeId === id ? (order[0] ?? null) : s.activeId
        return { workspaces, order, activeId, ...clearPaneRuntime(s, paneIds), schedules: schedulesWithout(s.schedules, paneIds) }
      })
      // Only the main window keeps at least one workspace; a floating window that loses its sole
      // workspace closes instead of re-seeding a phantom one.
      if (get().order.length === 0 && get().isMainWindow) get().newWorkspace('Workspace 1')
      scheduleAutosave()
      reportAssignment()
    },

    moveWorkspace: (fromId, toId) => {
      set(s => ({ order: reorderIds(s.order, fromId, toId) }))
      scheduleAutosave()
      reportAssignment()
    },

    // (Workspace documents — the File-menu `.thws` actions — live in store/workspace-docs-slice.ts.)

    // opts.refocusPane=false keeps keyboard focus where it is — used by keyboard tab-navigation,
    // where the retrying pane refocus would otherwise yank focus off the tab button a few frames
    // after the switch and break continued arrow-key navigation.
    setActive: (id, opts) => {
      set({ activeId: id }); scheduleAutosave(); reportAssignment()
      if (opts?.refocusPane !== false) get().refocusActivePane()
    },

    /** Put keyboard focus back on the active workspace's pane: the one the user last focused if it
     *  still lives in this workspace, otherwise its first pane. Used on tab switch (so the first
     *  terminal is ready to type) and after a dialog closes (so typing isn't silently swallowed). */
    refocusActivePane: () => {
      const s = get()
      const ws = s.activeId ? s.workspaces[s.activeId] : undefined
      if (!ws) return
      const target = (s.focusedPaneId && ws.panes[s.focusedPaneId]) ? s.focusedPaneId : firstTarget(ws)
      // Tracked: when the previous focusedPaneId lives in another workspace the fallback pane
      // becomes the real focused pane — leaving the store pointing across workspaces would send
      // the pane chords at a pane the user can't even see.
      if (target) focusPaneTracked(target)
    },

    setLayout: (wsId, layout) => {
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: { ...s.workspaces[wsId], layout } } }))
      scheduleAutosave()
    },

    toggleMaximize: (wsId, paneId) => {
      // REQ-010 mutual exclusion (runtime path): never maximize a currently-minimized pane — that
      // would leave it in BOTH maps (incoherent, and it would HIDE the surviving visible pane). The
      // minimize path already clears maximize (minimizePane / toggleMinimize); this enforces the
      // symmetric direction, closing the stale-focus → maximize footgun (FINDING-SEC-001 / TEST-041).
      if ((get().minimized[wsId] ?? []).includes(paneId)) return
      set(s => {
        const maximized = { ...s.maximized }
        if (maximized[wsId] === paneId) delete maximized[wsId]
        else maximized[wsId] = paneId
        return { maximized }
      })
      scheduleAutosave()   // maximize is now persisted (REQ-008)
      // Land keyboard focus in the pane the user just maximized (or un-maximized — it stays
      // visible either way) so they can type immediately instead of leaving focus on the button.
      focusPaneTracked(paneId)
    },

    /** Minimize a not-minimized pane, or restore an already-minimized one. Minimize keeps the pane
     *  fully alive off-layout: it reuses the same-window move plumbing (stash the terminal's
     *  scrollback / flush the editor's draft) so the kept-mounted host re-adopts it via the
     *  idempotent pty:spawn — it NEVER tears the PTY down (C2/C3). Idempotent / unknown-id-safe
     *  (REQ-017). Minimizing the maximized pane clears its maximize first (REQ-010). */
    toggleMinimize: (wsId, paneId) => {
      const s = get()
      const ws = s.workspaces[wsId]
      if (!ws || !ws.panes[paneId]) return
      if ((s.minimized[wsId] ?? []).includes(paneId)) { get().restorePane(wsId, paneId); return }
      const kind = ws.panes[paneId].config.kind
      // Arm the kept-alive transit BEFORE the source unmounts (armMainTransit: minimize's source
      // unmounts before the off-layout host mounts, so gap-window pty:data must be buffered on
      // main). The remount re-adopts via the idempotent pty:spawn. See stashPaneForTransit below.
      stashPaneForTransit(paneId, kind, { armMainTransit: true })
      const wasFocused = s.focusedPaneId === paneId
      set(st => {
        const cur = st.minimized[wsId] ?? []
        const minimized = { ...st.minimized, [wsId]: cur.includes(paneId) ? cur : [...cur, paneId] }
        const maximized = { ...st.maximized }
        if (maximized[wsId] === paneId) delete maximized[wsId]
        return { minimized, maximized }
      })
      scheduleAutosave()
      // QOL-002: minimizing the FOCUSED pane orphans keyboard focus on <body>; move it to a surviving
      // visible pane (one not minimized) so typing isn't silently swallowed (mirrors restorePane).
      if (wasFocused) {
        const nextMin = get().minimized[wsId] ?? []
        const survivor = Object.keys(ws.panes).find(id => id !== paneId && !nextMin.includes(id))
        if (survivor) focusPaneTracked(survivor)
      }
    },

    /** Restore a minimized pane back into the visible layout, split to the right (REQ-006). Symmetric
     *  to minimize: stash/flush so the remount keeps scrollback / unsaved edits, then focus it.
     *  No-op when the pane is unknown or not minimized (REQ-017). */
    restorePane: (wsId, paneId) => {
      const s = get()
      const ws = s.workspaces[wsId]
      const ids = s.minimized[wsId] ?? []
      if (!ws || !ws.panes[paneId] || !ids.includes(paneId)) return
      const kind = ws.panes[paneId].config.kind
      // Symmetric to minimize: arm the kept-alive transit before the off-layout host unmounts so
      // the restored tile re-adopts the live PTY and keeps scrollback / unsaved edits / explorer
      // expanded-set across the remount (see stashPaneForTransit below).
      stashPaneForTransit(paneId, kind, { armMainTransit: true })
      const restored = restorePaneModel({ ...ws, minimized: ids }, paneId)
      set(st => {
        // QUAL-001: apply the pure reducer's own `restored.minimized` rather than re-deriving the
        // filtered list independently, so the store and the reducer can never diverge.
        const rest = restored.minimized ?? []
        const minimized = { ...st.minimized }
        if (rest.length) minimized[wsId] = rest; else delete minimized[wsId]
        return { workspaces: { ...st.workspaces, [wsId]: { ...st.workspaces[wsId], layout: restored.layout } }, minimized }
      })
      scheduleAutosave()
      focusPaneTracked(paneId)
    },

    // Also stamps the pane's focus recency (feature 0006, REQ-009); the entry is pruned by the
    // same clearPaneRuntime call that drops the pane's other runtime maps (CONV-011).
    setFocusedPane: (paneId) => set(s => ({
      focusedPaneId: paneId,
      paneFocusSeq: { ...s.paneFocusSeq, [paneId]: ++paneFocusCounter }
    })),

    /** Move a pane to another workspace THIS window already hosts, following it with the active tab.
     *  Terminals keep scrollback (snapshot stash) + their running PTY (re-adopted by pty:spawn);
     *  editors keep unsaved edits (in-transit draft flush). Never tears down the PTY. */
    movePaneToWorkspace: (paneId, fromWsId, toWsId) => {
      const s = get()
      const from = s.workspaces[fromWsId]
      const to = s.workspaces[toWsId]
      if (!from || !to || fromWsId === toWsId || !from.panes[paneId]) return
      // Cross-home moves are refused BEFORE any mutation (feature 0022, REQ-018 / locked decision
      // 7: a running PTY cannot teleport machines; even same-agent workspaces hold two connections).
      const refusal = paneMoveRefusalReason(from.home, to.home)
      if (refusal !== null) { get().pushToast(refusal, 'error'); return }
      // The shared transit stash (see stashPaneForTransit below). armMainTransit is FALSE here —
      // the same-window cross-workspace move is ONE synchronous React commit, so no pty:data can
      // fall in a gap and the main-side transit buffer must NOT be armed (the sanctioned
      // asymmetry with minimize/restore; CLAUDE.md pins it).
      stashPaneForTransit(paneId, from.panes[paneId].config.kind, { armMainTransit: false })
      const moved = movePane(from, to, paneId)
      set(st => {
        const maximized = { ...st.maximized }
        if (maximized[fromWsId] === paneId) delete maximized[fromWsId]
        // The moved pane lands visible in the destination — clear its minimized flag in the source
        // so it is never left as an unreachable mid-move tray entry (REQ-015).
        const minimized = removeFromMinimized(st.minimized, fromWsId, paneId)
        return { workspaces: { ...st.workspaces, [fromWsId]: moved.from, [toWsId]: moved.to }, activeId: toWsId, maximized, minimized }
      })
      scheduleAutosave()
      reportAssignment()
      // The move follows the pane with the active tab — land keyboard focus in the moved pane too
      // (activeId was set directly above, bypassing setActive's refocus, so nothing else focuses it).
      focusPaneTracked(paneId)
    },

    /** Move a pane into a brand-new workspace, carrying the source workspace's theme override so the
     *  pane renders the same in its new home. */
    movePaneToNewWorkspace: (paneId, fromWsId) => {
      const from = get().workspaces[fromWsId]
      if (!from?.panes[paneId]) return
      // Guard FIRST (FINDING-003): a refused cross-home move must not strand an orphan empty
      // workspace — the destination is always LOCAL (newWorkspace), so consult the predicate
      // against a local home before creating anything.
      const refusal = paneMoveRefusalReason(from.home, undefined)
      if (refusal !== null) { get().pushToast(refusal, 'error'); return }
      const newId = get().newWorkspace(`Workspace ${get().order.length + 1}`)
      set(s => ({ workspaces: { ...s.workspaces, [newId]: carryTheme(s.workspaces[newId], from) } }))
      get().movePaneToWorkspace(paneId, fromWsId, newId)
    },

    // ---- core: pane management ----
    addTerminal: (wsId, targetPaneId, dir, splitDir) => {
      // A compass SPLIT inherits the source terminal's shell (splitting a WSL pane should give
      // another WSL pane, not the global default) — it already inherits the cwd. The "+ pane"
      // add (no splitDir) keeps the global default shell (QoL 2026-07-17).
      const targetCfg = targetPaneId ? get().workspaces[wsId]?.panes[targetPaneId]?.config : undefined
      const shellId = (splitDir && targetCfg?.kind === 'terminal') ? targetCfg.shellId : defaultShellId(get())
      const cwd = targetPaneId ? paneCwd(get(), targetPaneId) : ''
      return commitPane(wsId, { kind: 'terminal', shellId, cwd }, { target: targetPaneId, dir, splitDir })
    },

    addPaneOfKind: (wsId, kind) =>
      dispatchAddPane(get(), wsId, kind, () => api.openFolder(), () => get().pickOrkyRoot()),

    closePane: (wsId, paneId) => {
      // Confirm before a close that would kill a running process/AI session or discard unsaved
      // editor tabs (and their hot-exit drafts) — close-pane used to be the one silent kill while
      // close-workspace and per-tab close both confirmed. Idle panes close without friction.
      const s = get()
      const pane = s.workspaces[wsId]?.panes[paneId]
      if (pane) {
        const text = paneCloseConfirmText({
          kind: pane.config.kind,
          dirtyCount: paneDirtyCount(paneId),
          foreground: s.procs[paneId]?.foreground,
          aiLabel: s.aiSessions[paneId]?.label
        })
        if (text && !window.confirm(text)) return
      }
      const ws = removePane(get().workspaces[wsId], paneId)
      teardownPanes([paneId])
      set(s => {
        const maximized = { ...s.maximized }
        if (maximized[wsId] === paneId) delete maximized[wsId]
        // Drop the closed pane from the minimized tray so no orphan chip / view-state lingers (REQ-017).
        const minimized = removeFromMinimized(s.minimized, wsId, paneId)
        return { workspaces: { ...s.workspaces, [wsId]: ws }, maximized, minimized, ...clearPaneRuntime(s, [paneId]), schedules: schedulesWithout(s.schedules, [paneId]) }
      })
      scheduleAutosave()
    },

    addEditor: (wsId, targetPaneId, dir, splitDir) =>
      commitPane(wsId, { kind: 'editor', files: [] }, { target: targetPaneId, dir, splitDir, markEditor: true }),

    addExplorer: (wsId, targetPaneId, dir, root, splitDir) =>
      commitPane(wsId, { kind: 'explorer', root }, { target: targetPaneId, dir, splitDir }),

    // Native OrkyPane (feature 0009, REQ-001/REQ-004/REQ-005): mirrors addExplorer exactly —
    // config.root is committed VERBATIM (the picker hands over the aggregate entry's spelling).
    addOrky: (wsId, targetPaneId, dir, root, splitDir) =>
      commitPane(wsId, { kind: 'orky', root }, { target: targetPaneId, dir, splitDir }),

    /** Open the shared OrkyRootPicker chrome (feature 0009, REQ-004) and resolve with the picked
     *  member root (verbatim) or null on cancel/Escape. A superseding request cancels the stale
     *  one so at most one picker is ever pending. */
    pickOrkyRoot: () => new Promise<string | null>((resolvePick) => {
      orkyRootPickResolve?.(null)
      orkyRootPickResolve = resolvePick
      set({ orkyRootPickOpen: true })
    }),

    resolveOrkyRootPick: (root) => {
      const resolvePick = orkyRootPickResolve
      orkyRootPickResolve = null
      set({ orkyRootPickOpen: false })
      resolvePick?.(root)
    },

    openExplorerHere: (wsId, paneId) => {
      const root = paneCwd(get(), paneId)
      if (!root) return
      get().addExplorer(wsId, paneId, 'row', root)
    },

    openFileInEditor: (wsId, path) => {
      const ws = get().workspaces[wsId]
      const last = get().lastEditorPaneId
      const editorId = (last && ws.panes[last]?.config.kind === 'editor')
        ? last
        : Object.keys(ws.panes).find(id => ws.panes[id].config.kind === 'editor') ?? null
      if (editorId) {
        const cfg = ws.panes[editorId].config as EditorConfig
        const files = cfg.files.includes(path) ? cfg.files : [...cfg.files, path]
        get().updatePaneConfig(wsId, editorId, { files, activePath: path })
        set({ lastEditorPaneId: editorId })
      } else {
        commitPane(wsId, { kind: 'editor', files: [path], activePath: path }, { target: firstTarget(ws), dir: 'row', markEditor: true })
      }
    },

    updatePaneConfig: (wsId, paneId, patch) => {
      const ws = get().workspaces[wsId]
      const pane = ws?.panes[paneId]
      if (!pane) return
      const config = { ...(pane.config as object), ...patch } as PaneConfig
      const updated: Workspace = { ...ws, panes: { ...ws.panes, [paneId]: { ...pane, config } } }
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: updated } }))
      scheduleAutosave()
    },

    registerEditorPane: (paneId) => set({ lastEditorPaneId: paneId }),

    launchCommand: (launch) => {
      const wsId = get().activeId
      if (!wsId) return
      const ws = get().workspaces[wsId]
      const shellId = defaultShellId(get())
      commitPane(wsId, { kind: 'terminal', shellId, cwd: '', name: launch.title, launch }, { target: firstTarget(ws), dir: 'row' })
    },

    /** The NARROW resume-in-terminal composition (feature 0008, REQ-014 / FINDING-008): ONE
     *  terminal pane at `cwd` running `launch`. Kind, shell and placement are fixed HERE — the
     *  launchCommand-shaped pattern every pane-opening entry point follows; no capability-bearing
     *  field rides through — and the F6 pane-less fallback creates a workspace when the window
     *  has none. The raw pane-commit primitive stays store-internal (SliceDeps only). */
    launchTerminalAt: (cwd, launch) => {
      const wsId = get().activeId ?? get().newWorkspace('Workspace 1')
      const ws = get().workspaces[wsId]
      if (!ws) return
      const shellId = defaultShellId(get())
      commitPane(wsId, { kind: 'terminal', shellId, cwd, name: launch.title, launch }, { target: firstTarget(ws), dir: 'row' })
    },

    // ---- core: transient UI ----
    setPaletteOpen: (open) => set({ paletteOpen: open }),
    setBroadcastOpen: (open) => set({ broadcastOpen: open }),
    setConnectionForm: (target) => set({ connectionFormFor: target }),

    broadcastInput: (text, mode, enter) => {
      const s = get()
      const ws = s.activeId ? s.workspaces[s.activeId] : null
      if (!ws) return
      const data = encodeBroadcast(text, mode, enter)
      for (const id of terminalPaneIds(ws)) api.ptyWrite({ id, data })
    },

    // Run a saved command in one terminal: raw keystrokes + CR (same plumbing as broadcastInput).
    // Lives on the root store (not the run-commands slice) so the slice stays api-free/unit-testable.
    runCommand: (paneId, command) => api.ptyWrite({ id: paneId, data: encodeBroadcast(command, 'keys', true) })
  }
})

/** The ONE pane-transit stash (2026-07-17 audit, Finding 5 — it was triplicated across
 *  minimize/restore/move and had DRIFTED: the cross-workspace move omitted the explorer branch,
 *  silently losing an explorer pane's expanded folders + scroll). Arms the renderer-side keepers
 *  for a pane about to unmount in a kept-alive transition, so the remount re-adopts everything:
 *  - terminal: stashSnapshot of its serialized scrollback (consumed by the remounting
 *    TerminalPane; the running PTY itself is re-adopted by the idempotent pty:spawn);
 *  - editor: beginPaneTransit so the unmount FLUSHES its unsaved-edit draft instead of deleting
 *    it (pane-transit.ts);
 *  - explorer: stash its expanded-set + scroll (DA-001, explorer-registry.ts).
 *
 *  `armMainTransit` is the SANCTIONED asymmetry (CLAUDE.md): minimize/restore unmount the source
 *  pane BEFORE the destination host mounts, so gap-window pty:data must be buffered on main
 *  (api.ptyTransitBegin, reusing WindowManager.transit — CODEX-001); the same-window
 *  cross-workspace move is ONE synchronous React commit with no gap and must NOT arm the buffer
 *  ("Don't add a transit buffer here thinking it's a missing piece").
 *
 *  A hoisted function declaration kept BELOW the store deliberately: frozen TEST-2270
 *  (remote-ux-structure) anchors the stash machinery (`stashSnapshot`) after the
 *  `movePaneToWorkspace: (` source position — the guard-before-stash ordering it pins now lives
 *  in movePaneToWorkspace's own body (refusal guard, then the stashPaneForTransit call). */
function stashPaneForTransit(paneId: string, kind: PaneConfig['kind'], opts: { armMainTransit: boolean }): void {
  if (kind === 'terminal') {
    if (opts.armMainTransit) api.ptyTransitBegin(paneId)
    const snap = readPaneSnapshot(paneId)
    if (snap) stashSnapshot(paneId, snap)
  }
  if (kind === 'editor') beginPaneTransit(paneId)
  if (kind === 'explorer') {
    const es = readExplorerState(paneId)
    if (es) stashExplorerState(paneId, es)
  }
}
