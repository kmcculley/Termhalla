import type { State, SliceDeps } from './types'

type OrkyCaptureSlice = Pick<State, 'orkyCaptureRequest' | 'openOrkyCapture' | 'closeOrkyCapture'>

/**
 * The quick-capture request slice (feature 0012, TASK-006 — REQ-002/REQ-004/REQ-006/REQ-012): the
 * ONE store-level entry point every invocation path shares — the chord/palette path today, the
 * OrkyPane "inject" gesture later (D4) — holding exactly what both callers must agree on: is
 * capture open, and for which root.
 *
 *   null             = closed
 *   { root: null }   = open, picker-first flow (no pre-selected root)
 *   { root: string } = open, form-direct flow — the pre-selected root held BYTE-VERBATIM (no
 *                      re-casing/re-slashing/normalizing; membership is the dispatcher's job,
 *                      never re-validated client-side)
 *
 * Re-invoking openOrkyCapture while open is a REFERENCE-STABLE no-op (REQ-006 — a chord re-press
 * must never reset the typed draft or hijack the flow's root); closeOrkyCapture resets to null
 * unconditionally — the SOLE reset chokepoint every close path calls, so a reopen starts fresh
 * (REQ-012). The typed draft and in-flight/error state are component-local to OrkyCaptureModal
 * (decision #8): this slice owns no draft, no persistence, no per-workspace/per-pane keyed state,
 * and no IPC.
 */
export function createOrkyCaptureSlice({ set, get }: SliceDeps): OrkyCaptureSlice {
  return {
    orkyCaptureRequest: null,
    openOrkyCapture: (root?: string) => {
      if (get().orkyCaptureRequest !== null) return // already open — never reset (REQ-006)
      set({ orkyCaptureRequest: { root: root ?? null } })
    },
    closeOrkyCapture: () => set({ orkyCaptureRequest: null })
  }
}
