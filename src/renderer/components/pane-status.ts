import type { OrkyPaneStatus, OrkyKind, TermState } from '@shared/types'

/** Map an Orky run's kind onto the byte-status border model so the Orky precedence (REQ-014) reuses
 *  the existing `term-busy` / `term-needs-input` border treatment. `done`/`cleared` read as `idle`. */
export const ORKY_KIND_TO_TERM: Record<OrkyKind, TermState> = {
  busy: 'busy', 'needs-input': 'needs-input', idle: 'idle', done: 'idle', cleared: 'idle'
}

/** Compose the pane border's state + failure treatment from the Orky roll-up and the byte-derived
 *  (OSC 133) terminal status. Pure — separated from PaneTile's rendering the way `tab-badge.ts`
 *  separates the badge aggregation, so the precedence is unit-testable under the node harness.
 *
 *  The Orky precedence (REQ-014) is gated on `orky.chipFeature` — the SAME condition PaneToolbar uses
 *  to show the chip — NOT on the roll-up merely being present: `orkyPaneStatus([])` returns a NON-null
 *  idle roll-up (`chipFeature: null`) whenever a project has no popover-eligible features, and keying
 *  on presence alone would let that idle shape mask a real busy/needs-input border or a real
 *  `lastExit: 'failure'` treatment while the chip correctly hides itself. An idle roll-up therefore
 *  falls through to the byte status, exactly like a cleared (`undefined`) one. */
export function paneBorderStatus(
  orky: OrkyPaneStatus | undefined,
  byteState: TermState,
  lastExit: 'success' | 'failure' | undefined
): { state: TermState; failed: boolean } {
  if (orky?.chipFeature) return { state: ORKY_KIND_TO_TERM[orky.kind], failed: orky.failed }
  return { state: byteState, failed: lastExit === 'failure' }
}

/** Split the Orky chip label into its feature slug and its actionable tail
 *  (` · phase · gate N/M · ●k open`) so the render can shrink-clip the SLUG while the tail never
 *  shrinks (FINDING-UX-004: the fixed-width chip's end-ellipsis used to hide the at-a-glance
 *  gate/count first and always keep the slug). Splits only at the exact `slug · ` prefix; any
 *  other shape falls back to the whole label as the slug — never a mis-split. */
export function splitChipLabel(
  label: string, chipFeature: string | null
): { slug: string; tail: string } {
  if (chipFeature && label === chipFeature) return { slug: chipFeature, tail: '' }
  if (chipFeature && label.startsWith(`${chipFeature} · `)) {
    return { slug: chipFeature, tail: label.slice(chipFeature.length) }
  }
  return { slug: label, tail: '' }
}

/** Compose the pane title with its ambient-state prefixes. Prefixes ride the title TEXT
 *  (paint-only — the toolbar box never changes size; the 🔔 bell established the pattern).
 *  ⏺ marks an active recording: since Record moved into the right-click menu (feature 0002,
 *  FINDING-DEV-001/UX-006), the title glyph is the only at-a-glance cue a session is writing
 *  to disk. Recording (ambient) precedes the bell (attention). */
export function paneTitle(
  baseName: string, opts: { needsInput: boolean; recording: boolean }
): string {
  return `${opts.recording ? '⏺ ' : ''}${opts.needsInput ? '🔔 ' : ''}${baseName}`
}
