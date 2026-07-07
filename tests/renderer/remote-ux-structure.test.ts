// FROZEN suite — feature 0022-client-routing-remote-workspace-ux (phase 4 / TASK-011 + TASK-012 +
// TASK-013 + TASK-014).
// REQ-016 (the banner view-model), REQ-017 (the capability gates + their consumers), REQ-011's
// renderer side (usage/orky watchers skip remote panes), REQ-015 (the new-remote-workspace flow's
// registration parity + entry points), REQ-018 (the cross-home move guard site).
//
// Mix of PURE unit tests (banner model, remote-gates) and CONV-032-ANCHORED source pins for the
// wiring that only e2e can execute (each pin is scoped from a named anchor — never a bare
// whole-file literal — and keyed on feature-specific symbols per CONV-037).
//
// Chosen contracts (frozen here):
//   src/renderer/components/remote-banner-model.ts exports
//     remoteBannerModel(home: WorkspaceHome | undefined, state: RemoteWorkspaceState | undefined):
//       null | { phase: 'connecting' | 'disconnected'; headline: string; detail?: string;
//                action: 'cancel' | 'reconnect' }
//   src/renderer/store/remote-gates.ts exports (all pure over the store-state shape)
//     workspaceHomeOf(s, wsId): WorkspaceHome | undefined
//     workspaceAllowedDomains(s, wsId): 'all' | readonly string[]
//     domainAllowed(s, wsId, domain: string): boolean
//     paneIsRemote(s, paneId): boolean
//
// Runs RED today: neither module exists; none of the wiring pins hold.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { remoteBannerModel } from '../../src/renderer/components/remote-banner-model'
import { workspaceHomeOf, workspaceAllowedDomains, domainAllowed, paneIsRemote } from '../../src/renderer/store/remote-gates'
import type { RemoteWorkspaceState } from '@shared/remote-workspace'
import type { WorkspaceHome } from '@shared/remote-home'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

const home: WorkspaceHome = { kind: 'agent', agentId: 'a-1', agentName: 'buildbox' }
const rstate = (over: Partial<RemoteWorkspaceState> = {}): RemoteWorkspaceState => ({
  workspaceId: 'ws-1', agentId: 'a-1', agentName: 'buildbox',
  phase: 'connected', capabilities: ['pty', 'status'], ...over
})

describe('remoteBannerModel (REQ-016)', () => {
  it('TEST-2263 REQ-016 no banner for local or connected; connecting offers cancel; disconnected reasons carry copy + reconnect', () => {
    expect(remoteBannerModel(undefined, undefined)).toBeNull()
    expect(remoteBannerModel(home, rstate())).toBeNull()

    const connecting = remoteBannerModel(home, rstate({ phase: 'connecting', capabilities: [] }))!
    expect(connecting.phase).toBe('connecting')
    expect(connecting.action).toBe('cancel')
    expect(connecting.headline).toContain('buildbox')

    const stolen = remoteBannerModel(home, rstate({ phase: 'disconnected', reason: 'lease-stolen', capabilities: [] }))!
    expect(stolen.action).toBe('reconnect')
    expect(stolen.headline.toLowerCase()).toMatch(/another client|attached elsewhere/)

    const failed = remoteBannerModel(home, rstate({
      phase: 'disconnected', reason: 'connect-failed', capabilities: [], diagnostic: 'ssh exited 255: host unreachable'
    }))!
    expect(failed.action).toBe('reconnect')
    expect(failed.detail).toContain('ssh exited 255')
    // a remote-home workspace with NO state yet still explains itself (not-yet-connected):
    expect(remoteBannerModel(home, undefined)).not.toBeNull()
  })
})

describe('remote-gates (REQ-017, REQ-011)', () => {
  const s = {
    workspaces: {
      'ws-r': { id: 'ws-r', name: 'R', layout: 'p-r', panes: { 'p-r': { paneId: 'p-r', config: { kind: 'terminal' } } }, home },
      'ws-l': { id: 'ws-l', name: 'L', layout: 'p-l', panes: { 'p-l': { paneId: 'p-l', config: { kind: 'terminal' } } } }
    },
    remoteStates: { 'ws-r': rstate({ workspaceId: 'ws-r' }) }
  } as never

  it('TEST-2266 REQ-017 the pure gates: home lookup, allowed-domain derivation, per-domain checks, pane->remote membership', () => {
    expect(workspaceHomeOf(s, 'ws-r')).toEqual(home)
    expect(workspaceHomeOf(s, 'ws-l')).toBeUndefined()
    expect(workspaceAllowedDomains(s, 'ws-l')).toBe('all')
    expect(workspaceAllowedDomains(s, 'ws-r')).toEqual(['pty', 'status'])
    expect(domainAllowed(s, 'ws-l', 'fs')).toBe(true)
    expect(domainAllowed(s, 'ws-r', 'fs')).toBe(false)
    expect(domainAllowed(s, 'ws-r', 'pty')).toBe(true)
    expect(domainAllowed(s, 'ws-r', 'recording')).toBe(false)
    expect(paneIsRemote(s, 'p-r')).toBe(true)
    expect(paneIsRemote(s, 'p-l')).toBe(false)
    expect(paneIsRemote(s, 'p-ghost')).toBe(false)
  })

  it('TEST-2267 REQ-017 REQ-011 the gate consumers reference the remote-gates surface (CONV-037-keyed wiring pins)', () => {
    // Pane-creation gating: SplitMenu kind buttons + the empty-workspace buttons.
    expect(read('src/renderer/components/SplitMenu.tsx')).toMatch(/domainAllowed|workspaceAllowedDomains/)
    expect(read('src/renderer/components/WorkspaceView.tsx')).toMatch(/domainAllowed|workspaceAllowedDomains/)
    // Recording default-start gate:
    expect(read('src/renderer/components/TerminalPane.tsx')).toMatch(/paneIsRemote|domainAllowed/)
    // Local-machine watchers must skip remote panes:
    expect(read('src/renderer/components/UsageWatcher.tsx')).toMatch(/paneIsRemote/)
    expect(read('src/renderer/components/OrkyWatcher.tsx')).toMatch(/paneIsRemote/)
  })
})

describe('banner + picker wiring (REQ-016, REQ-015 — anchored source pins)', () => {
  it('TEST-2264 REQ-016 WorkspaceView mounts the banner as a workspace-body overlay; the banner exposes the frozen testids', () => {
    const wsView = read('src/renderer/components/WorkspaceView.tsx')
    expect(wsView).toMatch(/<RemoteBanner/)
    const banner = read('src/renderer/components/RemoteBanner.tsx')
    expect(banner).toContain('data-testid="remote-banner"')
    expect(banner).toContain('data-testid="remote-reconnect"')
    expect(banner).toContain('data-testid="remote-cancel"')
    expect(banner).not.toMatch(/createPortal/) // a body-sibling overlay needs no portal (unlike tile children)
  })

  it('TEST-2268 REQ-015 newRemoteWorkspace: home assignment, one terminal at the agent home dir, and the load-bearing arrangement report before return', () => {
    const src = read('src/renderer/store.ts')
    const iFn = src.indexOf('newRemoteWorkspace')
    expect(iFn, 'store.ts defines newRemoteWorkspace').toBeGreaterThanOrEqual(0)
    const iHome = src.indexOf("kind: 'agent'", iFn)
    const iCwd = src.indexOf("cwd: ''", iFn)
    // AMENDED 2026-07-07 (quality audit Group C #8): the report now rides the shared registration
    // ritual (store/workspace-registration.ts), which owns autosave + the arrangement report.
    const iReport = src.indexOf('registerWorkspace(', iFn)
    expect(iHome, 'the created workspace carries an agent home').toBeGreaterThan(iFn)
    expect(iCwd, 'the seeded terminal lands at the agent home dir (empty cwd)').toBeGreaterThan(iFn)
    expect(iReport, 'registerWorkspace() runs (0011 FINDING-001: an unreported workspace is lost)').toBeGreaterThan(iFn)
  })

  it('TEST-2269 REQ-015 the entry points exist: a TemplatesMenu built-in row and a CommandPalette action', () => {
    const tpl = read('src/renderer/components/TemplatesMenu.tsx')
    expect(tpl).toContain('data-testid="tpl-remote-workspace"')
    expect(tpl).toMatch(/newRemoteWorkspace/)
    const palette = read('src/renderer/components/CommandPalette.tsx')
    expect(palette).toMatch(/new-remote-workspace/)
    const picker = read('src/renderer/components/RemoteAgentPicker.tsx')
    expect(picker).toContain('data-testid="remote-agent-picker"')
  })

  it('TEST-2283 REQ-014 REQ-018 closeWorkspace tears panes down FIRST, then disconnects, then prunes the state entry; movePaneToNewWorkspace guards BEFORE creating the destination — added at the 2026-07-04 review→tests loopback (FINDING-002/FINDING-003)', () => {
    const src = read('src/renderer/store.ts')
    const iClose = src.indexOf('closeWorkspace: (')
    expect(iClose).toBeGreaterThanOrEqual(0)
    const iTeardown = src.indexOf('teardownPanes(', iClose)
    const iDisc = src.indexOf('disconnectRemote(', iClose)
    const iPrune = src.indexOf('pruneRemoteStates(', iClose)
    expect(iTeardown, 'panes torn down inside closeWorkspace').toBeGreaterThan(iClose)
    expect(iDisc, 'the remote teardown happens AFTER the panes are gone (the manager sees a pane-less entry and forgets it)').toBeGreaterThan(iTeardown)
    expect(iPrune, 'the slice entry is pruned (CONV-011)').toBeGreaterThan(iDisc)

    const iMoveNew = src.indexOf('movePaneToNewWorkspace: (')
    const iGuardNew = src.indexOf('paneMoveRefusalReason', iMoveNew)
    const iNewWs = src.indexOf('newWorkspace(', iMoveNew)
    expect(iMoveNew).toBeGreaterThanOrEqual(0)
    expect(iGuardNew, 'the refusal predicate is consulted inside movePaneToNewWorkspace').toBeGreaterThan(iMoveNew)
    expect(iGuardNew, 'the guard runs BEFORE the destination workspace exists (no orphan on refusal)').toBeLessThan(iNewWs)
  })

  it('TEST-2270 REQ-018 movePaneToWorkspace refuses cross-home moves BEFORE any mutation (guard precedes the stash/move machinery)', () => {
    const src = read('src/renderer/store.ts')
    const iMove = src.indexOf('movePaneToWorkspace: (')
    expect(iMove).toBeGreaterThanOrEqual(0)
    const iGuard = src.indexOf('paneMoveRefusalReason', iMove)
    const iStash = src.indexOf('stashSnapshot', iMove)
    const iModelMove = src.indexOf('movePane(', iMove)
    expect(iGuard, 'the pure refusal predicate is consulted').toBeGreaterThan(iMove)
    expect(iGuard).toBeLessThan(iStash)
    expect(iGuard).toBeLessThan(iModelMove)
  })
})
