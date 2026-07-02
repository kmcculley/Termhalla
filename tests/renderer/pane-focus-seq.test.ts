// FROZEN unit suite — feature 0006-decision-queue-panel (phase 4 / REQ-009 recency + CONV-011 pruning).
// Click-to-focus targets the MOST-RECENTLY-FOCUSED matching pane in this window. Recency comes from a
// store-maintained `paneFocusSeq` map (stamped monotonically by setFocusedPane), pruned by the SAME
// pane-removal cleanup that clears every other per-pane runtime map (`clearPaneRuntime`,
// FINDING-005/CONV-011 — the map never outlives the open-pane set, so a reused pane id inherits no
// stale rank). The pure MRU pick is `selectMruPane` (chosen contract, 04-tests.md).
// Runs RED: clearPaneRuntime does not yet clear paneFocusSeq, and selectMruPane does not exist.
import { describe, it, expect, vi } from 'vitest'

// internals.ts re-exports teardownPanes which calls api (window.termhalla) — mock it so the pure
// clearPaneRuntime can be imported in the node test environment (same pattern as clear-pane-runtime.test.ts).
vi.mock('../../src/renderer/api', () => ({ api: {} }))

import { clearPaneRuntime } from '../../src/renderer/store/internals'
import { selectMruPane } from '@shared/decision-queue'
import type { State } from '../../src/renderer/store/types'

describe('paneFocusSeq pruning on pane close (REQ-009 / CONV-011)', () => {
  it('TEST-341 REQ-009 clearPaneRuntime deletes the closed pane key from paneFocusSeq and keeps the others', () => {
    const s = {
      statuses: {}, cwds: { p1: '/a', p2: '/b' }, procs: {}, aiSessions: {}, usage: {},
      recording: {}, gitStatus: {}, exited: {},
      paneFocusSeq: { p1: 3, p2: 7 }
    } as unknown as State
    const out = clearPaneRuntime(s, ['p1']) as unknown as { paneFocusSeq: Record<string, number>; cwds: Record<string, string> }
    // The SAME cleanup call that drops the other per-pane runtime maps drops the focus rank too —
    // no second, independent cleanup path (03-plan.md TASK-006 / risk note #3).
    expect(out.paneFocusSeq).toBeDefined()
    expect(out.paneFocusSeq.p1).toBeUndefined()
    expect(out.paneFocusSeq.p2).toBe(7)
    expect(out.cwds.p1).toBeUndefined()
  })
})

describe('selectMruPane — deterministic most-recently-focused pick (REQ-009)', () => {
  it('TEST-342 REQ-009 the highest focus sequence wins (focus P2 then P1 → P1); never-focused panes rank last', () => {
    const panes = [
      { paneId: 'p1', workspaceIndex: 0 },
      { paneId: 'p2', workspaceIndex: 0 }
    ]
    // P2 was focused first (seq 1), P1 most recently (seq 2) → clicking the item focuses P1.
    expect(selectMruPane(panes, { p2: 1, p1: 2 })?.paneId).toBe('p1')
    expect(selectMruPane(panes, { p2: 2, p1: 1 })?.paneId).toBe('p2')
    // A pane never focused this session is absent from the map and ranks LAST.
    expect(selectMruPane(panes, { p2: 5 })?.paneId).toBe('p2')
    expect(selectMruPane(panes, { p1: 5 })?.paneId).toBe('p1')
  })

  it('TEST-343 REQ-009 ties break deterministically: workspace order first, then pane-id CODEPOINT; empty input → null', () => {
    // No pane ever focused → workspace order decides.
    expect(selectMruPane([
      { paneId: 'b', workspaceIndex: 1 },
      { paneId: 'a', workspaceIndex: 1 },
      { paneId: 'c', workspaceIndex: 0 }
    ], {})?.paneId).toBe('c')
    // Same workspace → pane-id codepoint ('Z' 0x5A < 'a' 0x61 — codepoint, not locale).
    expect(selectMruPane([
      { paneId: 'a', workspaceIndex: 0 },
      { paneId: 'Z', workspaceIndex: 0 }
    ], {})?.paneId).toBe('Z')
    // Equal explicit sequences tie-break the same way.
    expect(selectMruPane([
      { paneId: 'p9', workspaceIndex: 2 },
      { paneId: 'p2', workspaceIndex: 1 }
    ], { p9: 4, p2: 4 })?.paneId).toBe('p2')
    expect(selectMruPane([], {})).toBeNull()
  })
})
