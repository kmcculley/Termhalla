// FINDING-CODEX-001 regression suite — feature 0007-orky-action-dispatch (loopback-3, ESC-006).
// Targets `src/shared/orky-action-result.ts`'s `mapCliRunToResult` — the pure exit-code + stdout-JSON ->
// `OrkyActionResult` mapper. Pins the fix contract (ESC-006 approved decision): the feedback+exit-0
// branch MUST inspect the parsed stdout's own `ok` field, not just the process exit code, per REQ-002's
// failure contract (ok:false must carry a specific errorKind/error for ANY failure) and REQ-011's
// explicit "mode/ok fields drive REQ-006/REQ-007" + "the CLI's own {error} message MUST be surfaced".
//
// The Orky feedback CLI documented stdout shapes (02-spec.md "Verified CLI contract"):
//   success:        { ok:true,  mode:'noop'|'file'|'http', event, sent, spooled }
//   internal error: { ok:false, mode:'noop', error, note:'emit is non-fatal' }
// Both the disabled-channel no-op AND the internal-error case report `mode:'noop'` — today (RED)
// `mapCliRunToResult` maps ANY feedback exit-0 to `{ok:true, data:parsed}` without ever looking at
// `parsed.ok`, so a real internal error is silently treated as success and only disambiguated (wrongly)
// downstream by the dispatcher's `data.mode !== 'noop'` checks — see
// `tests/main/orky-action-dispatcher-codex-001-regression.test.ts` for the dispatcher-level consequence.
//
// NEW file — does not modify `tests/shared/orky-action-result.test.ts` (FROZEN; TEST-178..195 untouched).
import { describe, it, expect } from 'vitest'
import { mapCliRunToResult } from '../../src/shared/orky-action-result'

describe('mapCliRunToResult — FINDING-CODEX-001: feedback exit-0 must inspect the parsed stdout\'s own `ok` field (REQ-002/REQ-011)', () => {
  it('TEST-295 REQ-002/011 feedback exit 0 with parsed {ok:false, mode:"noop", error:"boom", note:"emit is non-fatal"} maps to ok:false/errorKind:"cli-error", exitCode 0 preserved, error containing "boom" — NOT a silent ok:true', () => {
    const parsed = { ok: false, mode: 'noop', error: 'boom', note: 'emit is non-fatal' }
    const r = mapCliRunToResult('resolveEscalation', 'feedback', { exitCode: 0, stdout: JSON.stringify(parsed), timedOut: false })
    expect(r.ok).toBe(false)
    expect(r.exitCode).toBe(0) // ESC-006: exitCode 0 is preserved on the result even though ok is false
    expect(r.errorKind).toBe('cli-error')
    expect(r.error).toContain('boom')
  })

  it('TEST-296 REQ-002/011 regression guard: feedback exit 0 with parsed {ok:true, mode:"file", ...} is STILL ok:true — the success path must not regress when the ok:false branch is added', () => {
    const parsed = { ok: true, mode: 'file', event: 'evt-1', sent: true, spooled: false }
    const r = mapCliRunToResult('submitWork', 'feedback', { exitCode: 0, stdout: JSON.stringify(parsed), timedOut: false })
    expect(r).toMatchObject({ ok: true, exitCode: 0, data: parsed })
  })
})
