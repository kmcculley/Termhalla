// FROZEN unit suite — feature 0003-pane-minimize-restore (phase 4 / TASK-007 pure chip-status map).
// REQ-005: a minimized pane's tray chip must surface its live background status. This pins the PURE
// status -> indicator mapping the chip renders from. Runs RED today: `@shared/chip-status` does not
// exist yet (the whole file errors on import — that IS the want-of-implementation signal).
import { describe, it, expect } from 'vitest'
import { chipStatus } from '@shared/chip-status'

describe('chip-status pure mapping (REQ-005)', () => {
  it('TEST-019 REQ-005 maps idle | busy | needs-input, surfacing needsInput ONLY when blocked', () => {
    expect(chipStatus({ state: 'idle', recording: false, ai: false }).needsInput).toBe(false)
    expect(chipStatus({ state: 'busy', recording: false, ai: false }).needsInput).toBe(false)
    expect(chipStatus({ state: 'needs-input', recording: false, ai: false }).needsInput).toBe(true)
    // the runtime state passes through for the chip's running/idle indicator
    expect(chipStatus({ state: 'busy', recording: false, ai: false }).state).toBe('busy')
  })

  it('TEST-020 REQ-005 reflects recording and AI-session toggles on/off', () => {
    expect(chipStatus({ state: 'idle', recording: true, ai: false }).recording).toBe(true)
    expect(chipStatus({ state: 'idle', recording: false, ai: false }).recording).toBe(false)
    expect(chipStatus({ state: 'idle', recording: false, ai: true }).ai).toBe(true)
    expect(chipStatus({ state: 'idle', recording: false, ai: false }).ai).toBe(false)
  })
})

// ── Loop-back 2 (from review) ───────────────────────────────────────────────────────────────────
// FINDING-DA-003: REQ-005 enumerates running/idle/needs-input/recording/AI but a minimized terminal
// is NOT auto-closed when its shell exits — its chip keeps showing the last status (typically `idle`),
// making a dead terminal indistinguishable from a live idle one (a silent footgun, the opposite of
// REQ-005's intent). TASK-019 adds an `exited` state to chipStatus. CONTRACT for the implementer:
//   chipStatus({ state, recording, ai, exited? }) — `exited` is OPTIONAL (defaults false so existing
//   callers/tests are unaffected); when `exited === true` the returned `.state` is `'exited'`, which
//   WINS over idle/busy/needs-input (a dead shell never reads as a live state). The chip surfaces it
//   distinctly (the plan notes `data-status="exited"`). Runs RED today: chipStatus ignores `exited`.
describe('exited chip state (REQ-005)', () => {
  it('TEST-040 REQ-005 a minimized terminal whose process exits surfaces an `exited` state, not idle', () => {
    const r = chipStatus({ state: 'idle', recording: false, ai: false, exited: true } as Parameters<typeof chipStatus>[0])
    expect(r.state).toBe('exited')
    expect(r.needsInput).toBe(false)
  })

  it('TEST-040 REQ-005 a live (not-exited) terminal passes its runtime state through unchanged', () => {
    expect(chipStatus({ state: 'idle', recording: false, ai: false }).state).toBe('idle')
    // explicit exited:false is the same as omitting it — no exited override
    expect(chipStatus({ state: 'busy', recording: false, ai: false, exited: false } as Parameters<typeof chipStatus>[0]).state).toBe('busy')
  })
})
