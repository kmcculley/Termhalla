import type { TermState } from './types'

/** A minimized terminal whose shell process has exited is NOT auto-closed (its scrollback stays
 *  restorable), so the chip needs a state distinct from a live `idle` pane (REQ-005 / FINDING-DA-003)
 *  — otherwise a dead terminal is indistinguishable from a live quiet one (a silent footgun). */
export type ChipState = TermState | 'exited'

/** The live indicator a minimized pane's tray chip renders from. `needsInput` is surfaced as a
 *  distinct marker so a backgrounded pane blocking on input is never a silent footgun (REQ-005). */
export interface ChipStatus {
  state: ChipState
  needsInput: boolean
  recording: boolean
  ai: boolean
}

/**
 * Pure map from a minimized pane's live runtime signals to its chip indicator. This module exists
 * ONLY to give REQ-005 a stable, independently unit-testable surface (TEST-019/020/040) — it is not
 * a place to grow complex derivation logic; keep it total and trivial.
 *
 * `exited` (a dead shell) WINS over every live state so a backgrounded terminal whose process exited
 * never reads as a live `idle`/`busy`/`needs-input` (FINDING-DA-003). Otherwise `needsInput` is
 * exactly `state === 'needs-input'`; `state` passes through for the running/idle indicator, and the
 * recording / AI-session flags pass through unchanged. No DOM, no store.
 */
export function chipStatus(
  { state, recording, ai, exited }: { state: TermState; recording: boolean; ai: boolean; exited?: boolean }
): ChipStatus {
  if (exited) return { state: 'exited', needsInput: false, recording, ai }
  return { state, needsInput: state === 'needs-input', recording, ai }
}
