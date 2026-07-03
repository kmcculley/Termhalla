// 0015-orky-contract-v2-refresh — phase 4 (tests), REQ-110 / TASK-112 (structural half).
// The Orky pane's finding rows display the v2 finding_resolution details on RESOLVED findings only:
// when a finding's status case-insensitively equals 'resolved' (the producer's finding_normalization
// contract / the existing isBlockingFinding discipline — NOT the escalation row's strict `===`) AND
// its resolution is non-null, the row appends a dim `— resolution: <resolution>` affix (the
// resolved-escalation `— decision:` precedent), surfacing resolvedBy / a formatted resolvedAt on the
// same row (inline or via the row's title — implementer's choice, but observable).
//
// AMENDED 2026-07-03 — ESC-001 descent, tests-phase re-entry (TASK-116): amended REQ-110 adds two
// MUSTs, pinned structurally by TEST-722 below (rendered vectors in the e2e half, TEST-723/724):
// the display guard excludes the EMPTY string (`resolution !== null && resolution !== ''` — the
// spec names that exact guard shape), and whenever the affix renders the row's `title` mirrors the
// full row text (claim + affix) so a clipped row stays reachable — non-affixed rows keep the bare
// claim exactly as today.
//
// The vitest harness is node-env with no jsdom (vitest.config.ts), so this suite pins the contract
// the repo's established source-scan way (the tests/renderer/orky-pane-display-contract.test.ts
// precedent); the RENDERED vectors — including the open / resolved-with-null-resolution rows staying
// byte-identical to today — are pinned end-to-end in tests/e2e/orky-pane-resolution.spec.ts
// (TEST-716/TEST-717, plus the descent's TEST-723/TEST-724).
//
// Runs RED today (2026-07-03, against the shipped 0009/0010-era OrkyPane): the finding row renders only
// id/severity/status/blocking/claim — no resolution affix, no resolvedBy/resolvedAt consumption,
// and no case-insensitive resolved comparison exists in the file.
// Descent RED (2026-07-03, against the first-pass TASK-112 code): TEST-715 is GREEN, but TEST-722
// is RED — the guard is only `resolution !== null` and the finding row still pins `title={fd.claim}`.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pane = (): string => readFileSync(resolve(process.cwd(), 'src/renderer/components/OrkyPane.tsx'), 'utf8')

describe('finding rows surface finding_resolution on resolved findings only (REQ-110)', () => {
  it('TEST-715 REQ-110: the finding row consumes resolution/resolvedBy/resolvedAt behind a CASE-INSENSITIVE resolved check + a non-null resolution guard, renders the `— resolution:` affix, and formats the carried resolvedAt epoch via the shared formatter (never a renderer clock)', () => {
    const src = pane()

    // the affix literal itself (the resolved-escalation `— decision:` precedent, resolution flavor)
    expect(src, 'the dim `— resolution:` affix must exist').toMatch(/—\s?resolution:/)

    // the three carried v2 fields are consumed
    expect(src, 'the row must consume the carried resolution').toMatch(/\.resolution\b/)
    expect(src, 'the row must consume the carried resolvedBy').toMatch(/\.resolvedBy\b/)
    expect(src, 'the row must consume the carried resolvedAt').toMatch(/\.resolvedAt\b/)

    // resolved-ness is compared CASE-INSENSITIVELY (the producer's finding_normalization contract /
    // isBlockingFinding's discipline) — never the escalation row's strict `===` on the raw string
    expect(src, 'the finding resolved check must case-fold before comparing')
      .toMatch(/toLowerCase\(\)\s*===\s*'resolved'|toUpperCase\(\)\s*===\s*'RESOLVED'/)
    // exactly ONE strict `status === 'resolved'` may remain in the file — the ESCALATION row's
    // existing check; the finding row must not add a second (that shape misses 'Resolved')
    expect((src.match(/status\s*===\s*'resolved'/g) ?? []).length,
      "the finding row must not compare status with strict === 'resolved' (the escalation row's single existing site is the only one allowed)")
      .toBeLessThanOrEqual(1)

    // a resolved finding with resolution === null renders NO affix (and never `— resolution: null`):
    // the affix must be guarded on a non-null resolution
    expect(src, 'the affix must be guarded on resolution !== null').toMatch(/resolution\s*!==\s*null/)

    // resolvedAt is the payload's carried EPOCH — surfaced through the shared pure formatter, never
    // re-derived with a renderer clock (REQ-015 discipline; TEST-430/TEST-451's standing ban)
    expect(src, 'resolvedAt must flow through formatOrkyInstant').toMatch(/formatOrkyInstant\([^)]*resolvedAt/)
    expect(src).not.toMatch(/Date\.now\(|new Date\(/)
  })

  it("TEST-722 REQ-110 (amended, ESC-001): the affix guard EXCLUDES the empty string, and the finding row's title is no longer pinned to the bare claim — when the affix renders the title must mirror claim + full affix (clipped-row reachability); non-affixed rows keep the bare claim", () => {
    const src = pane()

    // (d) non-empty display guard — the amended spec names the exact guard shape
    // (`resolution !== null && resolution !== ''`; the REQ-109 mapper stays verbatim, no trimming):
    // a resolved finding with resolution '' must render NO affix and no dangling `— resolution:` label
    expect(src, "the affix guard must also exclude the empty string (resolution !== '')")
      .toMatch(/resolution\s*!==\s*(''|"")/)

    // (a) title mirror — structural half (the rendered mirror is TEST-723's e2e assertion).
    // CONV-032 anchor: this pin reads the OPEN TAG of the [data-testid="orky-pane-finding"] div —
    // the slice from the testid literal to the tag's closing '>' (no title/style expression on this
    // tag may contain a literal '>'; keep it that way or re-anchor this pin deliberately).
    const tagStart = src.indexOf('data-testid="orky-pane-finding"')
    expect(tagStart, 'the finding row must keep its testid').toBeGreaterThanOrEqual(0)
    const openTag = src.slice(tagStart, src.indexOf('>', tagStart))
    // the tooltip surface itself must survive — it is the clipped row's only full-text reach
    expect(openTag, 'the finding row must keep a title attribute (the clipped-row reachability surface)')
      .toMatch(/title=\{/)
    // …but it may no longer be UNCONDITIONALLY the bare claim: with the affix rendered the title
    // must carry claim + full affix text (TASK-120's shape — compose the affix once, feed both the
    // row and the title). Non-affixed rows keeping `title={fd.claim}` semantics is fine — the pin
    // rejects only the unconditional bare-claim expression.
    expect(openTag,
      "the finding row's title must not be unconditionally the bare claim — an affixed row's full text (claim + affix) must be reachable via the title")
      .not.toMatch(/title=\{fd\.claim\}/)
  })
})
