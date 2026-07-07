// 0024 ledger FINDING-028 (deferred at human-review, fixed 2026-07-07): after REQ-019 a REMOTE
// workspace's close-tab DETACHES — its terminals keep running on the daemon for reattach — but
// both confirm sites (WorkspaceTabs.tsx, App.tsx) still warned "Its terminals will be closed."
// for every workspace, telling a user who wants to END remote work that closing the tab did it.
// The copy is now derived from ONE pure helper conditional on the workspace home.
import { describe, it, expect } from 'vitest'
import { closeWorkspaceConfirmText, type WorkspaceHome } from '@shared/remote-home'

const home: WorkspaceHome = { kind: 'agent', agentId: 'a-1', agentName: 'buildbox' }

describe('closeWorkspaceConfirmText (0024 FINDING-028)', () => {
  it('a LOCAL workspace keeps the existing wording verbatim — its terminals really are closed', () => {
    expect(closeWorkspaceConfirmText('Workspace 1', undefined))
      .toBe('Close workspace "Workspace 1"? Its terminals will be closed.')
  })

  it('a REMOTE workspace states the detach truth: terminals keep running, reopening reattaches', () => {
    const text = closeWorkspaceConfirmText('OpsHub', home)
    expect(text).toContain('"OpsHub"')
    expect(text).toMatch(/keep running/i)
    expect(text).toMatch(/reopen/i)
    // never the local-kill claim
    expect(text).not.toMatch(/will be closed/i)
  })
})
