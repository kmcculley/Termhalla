# Intake — 0015-orky-contract-v2-refresh

**Captured:** 2026-07-03
**Source:** Kevin, relaying a handoff prompt authored by Claude in the Orky repo (plugin side)
after the Orky plugin's 0.30.0 release bumped its gatekeeper contract to v2.

## Idea (verbatim)

> Refresh the Orky contract mirror to v2 (plugin 0.30.0). The Orky gatekeeper's `contract`
> command now reports contract_version 2 (was 1), and Termhalla's mirrors still pin v1, so the
> startup handshake logs a version-skew warning. Scope: (1) bump EXPECTED_CONTRACT_VERSION to 2
> in src/main/orky/orky-contract-handshake.ts; (2) regenerate the golden fixtures in
> tests/fixtures/orky-contract/ from the live plugin using the existing regeneration tool;
> (3) update the hard-coded contract_version: 1 in tests/main/orky-cli-contract-handshake.test.ts;
> (4) reconcile any mirror of phase_order — its last entry changed from 'human' to 'human-review'
> (the phases list is unchanged). Also new in v2, adopt only if Termhalla displays them:
> finding_resolution fields (status/resolution/resolvedBy/resolvedAt) and the producer_tiers
> vocabulary. No behavior change expected beyond the handshake going quiet.

## Raw requirements (as relayed)

1. Bump `EXPECTED_CONTRACT_VERSION` to 2 in `src/main/orky/orky-contract-handshake.ts`.
2. Regenerate the golden fixtures in `tests/fixtures/orky-contract/` from the live plugin using
   the existing regeneration tool.
3. Update the hard-coded `contract_version: 1` in `tests/main/orky-cli-contract-handshake.test.ts`.
4. Reconcile any mirror of `phase_order` — its last entry changed from `'human'` to
   `'human-review'` (the phases list itself is unchanged).
5. Optional adoption, only if Termhalla actually displays them: the v2 `finding_resolution`
   fields (`status`/`resolution`/`resolvedBy`/`resolvedAt`) and the `producer_tiers` vocabulary.
6. Expected outcome: no behavior change beyond the startup handshake going quiet.

## Context already known in this repo (for the brainstorm)

- The skew is REAL and observed: `tests/integration/orky-act-loop.test.ts` TEST-691 (the live
  `gatekeeper contract` handshake) currently FAILS on a pristine tree — `verifyOrkyContract(...)`
  returns `ok: false` against the installed plugin (verified 2026-07-03 via stash). This feature
  should turn TEST-691 green again.
- CLAUDE.md carries a load-bearing provenance caveat for any phase-list re-sync: Termhalla's
  `ORKY_PHASES` is the 8-phase mirror of Orky's recorded **gate keys** / `DRIVER_WORK_PHASES` —
  NOT Orky's separate 9-entry `PHASE_ORDER` (intake…human). Requirement (4) touches exactly this
  territory (`'human'` → `'human-review'` as the last `phase_order` entry) — see
  `docs/features/orky-status.md` § provenance before changing any constant, and note
  `tests/main/orky-cli-contract-handshake.test.ts:120-123` already exercises a renamed-last-entry
  case (`[...ORKY_PHASES.slice(0, -1), 'human']`).
- Prior art for "gates vs phases" bugs: FINDING-DA-001 (needs-human must derive from gate
  topology, not phase-string equality). The v2 rename `human` → `human-review` aligns the
  plugin's vocabulary with the gate key Termhalla already uses — likely simplifying, but the
  mapping layer must be checked, not assumed.
- Tracked as session task #7 ("Re-sync Orky CLI contract handshake (TEST-691 failing,
  pre-existing)").

## Likely concern tags (indicative only — the spec commits them)

- `determinism` — golden fixtures + a version-pinned handshake; regeneration must be
  reproducible from the live plugin.
- `compatibility` / `contract-drift` — the whole feature is a cross-repo contract re-sync;
  mixed-version environments (older plugin, newer Termhalla and vice versa) need a defined
  handshake outcome (warn vs fail).
- `quality` — CHAR/frozen-test discipline: TEST-691 and the contract-handshake unit suite pin
  current behavior; updates must go through the tests phase, not ad-hoc edits.

## Explicit non-goals (from the intake)

- No new renderer UI for `finding_resolution` / `producer_tiers` unless Termhalla already
  displays those concepts somewhere (adopt-only-if-displayed rule).
- No driving of the Orky pipeline, no `.orky/` writes from Termhalla (the read-only invariant
  stands).
