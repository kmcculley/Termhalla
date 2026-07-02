// FROZEN unit suite — feature 0012-quick-capture-inbox (phase 4 — REQ-002/REQ-004/REQ-006/REQ-012).
// The capture store slice: the ONE store-level entry point BOTH invocation paths agree on (the
// chord/palette path now, F10's OrkyPane "inject" later — D4), driven as plain objects per the F6
// registry-slice harness pattern (no jsdom; 0009 03-plan.md "Testability constraint").
//
// Chosen contract (02-spec.md Public interface + 03-plan.md TASK-006 — this suite freezes it):
//   src/renderer/store/orky-capture-slice.ts exports
//     createOrkyCaptureSlice(deps: SliceDeps): Pick<State, 'orkyCaptureRequest' | 'openOrkyCapture' | 'closeOrkyCapture'>
//   over state field `orkyCaptureRequest: { root: string | null } | null`
//     null          = closed
//     { root: null }   = open, picker-first flow (no pre-selected root)
//     { root: string } = open, form-direct flow (D4 pre-selected root, stored BYTE-VERBATIM)
//   openOrkyCapture(root?: string) — NO-OP while already open (REQ-006: re-invocation never resets
//     the draft/in-flight component state; the zustand-observable seam is REFERENCE stability, the
//     TEST-332 precedent). closeOrkyCapture() — resets to null unconditionally (the SOLE reset
//     chokepoint every close path calls). The slice owns NO draft/in-flight/error state (that is
//     component-local, decision #8), NO persistence, NO per-pane keyed map (CONV-011 n/a, REQ-012),
//     and NO IPC.
//
// Runs RED today: src/renderer/store/orky-capture-slice.ts does not exist yet (module-not-found).
import { describe, it, expect, vi } from 'vitest'
import { createOrkyCaptureSlice } from '../../src/renderer/store/orky-capture-slice'

function harness() {
  let state: Record<string, unknown> = { orkyCaptureRequest: null }
  const set = (patch: unknown) => {
    state = { ...state, ...(typeof patch === 'function' ? (patch as (s: unknown) => object)(state) : patch as object) }
  }
  const get = () => state as never
  const scheduleAutosave = vi.fn(), scheduleQuickSave = vi.fn(), scheduleNotesSave = vi.fn(), commitPane = vi.fn()
  const slice = createOrkyCaptureSlice({ set, get, scheduleAutosave, scheduleQuickSave, scheduleNotesSave, commitPane } as never)
  return { slice, get: () => state, scheduleAutosave, scheduleQuickSave, scheduleNotesSave }
}

describe('openOrkyCapture — the D4 entry point (REQ-002/REQ-004)', () => {
  it('TEST-481 REQ-002 REQ-004 closed initially; openOrkyCapture() opens the picker-first flow ({root:null}); openOrkyCapture(root) opens form-direct holding the root BYTE-VERBATIM (no re-casing/re-slashing/normalizing)', () => {
    const { slice, get } = harness()
    expect(get().orkyCaptureRequest).toBeNull()          // closed until an explicit open

    slice.openOrkyCapture()                              // the chord/palette path — NO argument
    expect(get().orkyCaptureRequest).toEqual({ root: null })

    slice.closeOrkyCapture()
    const mixed = 'C:\\Mixed\\Case Root/'                // deliberately ugly: case + mixed separators + trailing slash
    slice.openOrkyCapture(mixed)                         // the D4 pre-selected path (F10's future call)
    const req = get().orkyCaptureRequest as { root: string | null }
    expect(req.root).toBe(mixed)                         // byte-equal — server-side membership is F7's job
  })

  it('TEST-482 REQ-006 re-invoking openOrkyCapture while open is a NO-OP: the held request keeps its REFERENCE (no reset, no root hijack) — for both the argument-less and the rooted re-invocation', () => {
    const { slice, get } = harness()
    slice.openOrkyCapture()                              // open picker-first
    const held = get().orkyCaptureRequest
    expect(held).toEqual({ root: null })

    slice.openOrkyCapture()                              // chord again while open — draft must survive
    expect(get().orkyCaptureRequest).toBe(held)          // reference-stable: nothing re-rendered, nothing reset

    slice.openOrkyCapture('C:\\Another\\Root')           // a rooted call while open must NOT hijack the flow
    expect(get().orkyCaptureRequest).toBe(held)

    // and symmetric: open form-direct, then a picker-first re-invocation is equally a no-op
    slice.closeOrkyCapture()
    slice.openOrkyCapture('C:\\ProjA')
    const heldRooted = get().orkyCaptureRequest
    slice.openOrkyCapture()
    expect(get().orkyCaptureRequest).toBe(heldRooted)
  })

  it('TEST-483 REQ-012 closeOrkyCapture resets to null UNCONDITIONALLY (a reopen starts fresh); the slice performs zero persistence side effects and holds no per-pane keyed state', () => {
    const { slice, get, scheduleAutosave, scheduleQuickSave, scheduleNotesSave } = harness()
    slice.openOrkyCapture('C:\\ProjA')
    slice.closeOrkyCapture()
    expect(get().orkyCaptureRequest).toBeNull()
    slice.closeOrkyCapture()                             // idempotent — closing while closed is safe (CONV-002)
    expect(get().orkyCaptureRequest).toBeNull()

    slice.openOrkyCapture()                              // reopen = fresh picker-first state, no residue
    expect(get().orkyCaptureRequest).toEqual({ root: null })

    // session-scoped chrome state ONLY (D1 "no persistent UI"): never a save schedule
    expect(scheduleAutosave).not.toHaveBeenCalled()
    expect(scheduleQuickSave).not.toHaveBeenCalled()
    expect(scheduleNotesSave).not.toHaveBeenCalled()
    // the slice's WHOLE surface is exactly what both callers need (minimal-surface, plan risk-note 2):
    // one request field + the two entry points — no per-pane map (CONV-011 n/a, REQ-012), nothing more
    expect(Object.keys(slice).sort()).toEqual(['closeOrkyCapture', 'openOrkyCapture', 'orkyCaptureRequest'])
  })
})
