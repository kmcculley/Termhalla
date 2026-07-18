// 2026-07-17 whole-project quality audit, Finding 7 (MAJOR): the indeterminate-outcome
// classification was triplicated and had drifted. The entry-actions CORE module owns the ONE
// honesty classification (INDETERMINATE_KINDS = cli-timeout / cli-unparseable / ipc-failure,
// with the FINDING-006 rationale that cli-unparseable can be a completed child whose write
// landed but whose report was unreadable — it proves NO non-dispatch), but OrkyCaptureModal
// hand-coded the check as `kind === 'cli-timeout' || kind === 'ipc-failure'` at BOTH its
// failure surfaces (the in-modal error region and the detached close-in-flight toast),
// omitting cli-unparseable — so such a capture rendered the DEFINITE "rejected" copy and
// invited exactly the blind duplicate-retry the classification exists to prevent.
//
// Fix contract pinned here: the core exports isIndeterminateKind(kind), and the modal routes
// BOTH sites through it (comments may still name the kinds — the frozen suites TEST-492/522/529
// grep for the literals — but no CODE hand-codes the kind list).
//
// NOTE: this file is a deliberate TEST-645 inventory hit (docs-feature-0010-loopback sweeps
// tests/** for the core module's name token) — dispositioned per that test's own rule and added
// to its list atomically; the disposition is recorded in
// .orky/features/0010-orky-pane-inline-actions/04-tests.md ("Inventory amendment").
//
// Ran RED before the fix: isIndeterminateKind did not exist (import fails), and the modal
// matched the hand-coded pair check.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isIndeterminateKind } from '../../src/renderer/components/orky-entry-actions-core'

const modal = (): string =>
  readFileSync(resolve(process.cwd(), 'src/renderer/components/OrkyCaptureModal.tsx'), 'utf8')

describe('isIndeterminateKind — the ONE indeterminate classification (FINDING-006)', () => {
  it('classifies cli-timeout, cli-unparseable AND ipc-failure indeterminate — an unparseable report can be a completed child whose write landed', () => {
    for (const kind of ['cli-timeout', 'cli-unparseable', 'ipc-failure']) {
      expect(isIndeterminateKind(kind), `${kind} must be indeterminate`).toBe(true)
    }
  })
  it('classifies every definite kind as NOT indeterminate', () => {
    for (const kind of ['cli-error', 'feedback-disabled', 'root-not-allowed', 'invalid-args', 'feature-not-found', 'orky-cli-not-found', 'unknown-sender', '']) {
      expect(isIndeterminateKind(kind), `${kind} must be definite`).toBe(false)
    }
  })
})

describe('OrkyCaptureModal — BOTH failure surfaces ride the shared predicate (audit Finding 7)', () => {
  it('imports isIndeterminateKind from the core and uses it at the detached-toast site AND the in-modal error-region guard — no hand-coded kind pair omitting cli-unparseable', () => {
    const src = modal()
    expect(src, 'the modal must import the shared predicate from the core module')
      .toMatch(/import\s*\{[^}]*isIndeterminateKind[^}]*\}\s*from\s*'\.\/orky-entry-actions-core'/)
    // Site 1: the detached close-while-in-flight toast branches through the predicate.
    const detachedAt = src.indexOf('!stillMounted')
    expect(detachedAt, 'the detached-outcome block must exist').toBeGreaterThanOrEqual(0)
    expect(src.slice(detachedAt, detachedAt + 1600), 'the detached toast must classify through isIndeterminateKind')
      .toContain('isIndeterminateKind(')
    // Site 2: the in-modal failure region's indeterminate-copy guard is the predicate too.
    const copyAt = src.search(/may or may not have been/i)
    expect(copyAt, 'the indeterminate in-modal copy must exist').toBeGreaterThanOrEqual(0)
    expect(src.slice(Math.max(0, copyAt - 600), copyAt), 'the error-region guard must classify through isIndeterminateKind')
      .toContain('isIndeterminateKind(')
    // The drifted hand-coded check (which omitted cli-unparseable) is gone from CODE.
    expect(src, 'no hand-coded kind comparison may remain').not.toMatch(/kind === '(cli-timeout|ipc-failure)'/)
  })
})
