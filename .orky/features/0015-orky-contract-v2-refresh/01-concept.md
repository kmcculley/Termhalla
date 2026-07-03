# Concept — 0015-orky-contract-v2-refresh

**Brainstormed:** 2026-07-03, Kevin + Claude (orchestrator).
**Ground truth consulted:** live `gatekeeper contract` output from the installed plugin (0.30.0,
`contract_version: 2`), the committed v1 fixture, `src/main/orky/orky-contract-handshake.ts`,
`tests/shared/orky-contract-golden.test.ts`, `tests/main/orky-cli-contract-handshake.test.ts`,
`src/shared/orky-status.ts`, `src/shared/types.ts` (`OrkyFindingDetail`),
`src/main/orky/orky-root-detail.ts` (`mapFinding`), `src/renderer/components/OrkyPane.tsx`.

## What v2 actually changed (verified against the live plugin, not assumed)

- `contract_version`: 1 → 2.
- `phases` (the 8-entry gate-key list `ORKY_PHASES` mirrors): **UNCHANGED**. No constant re-sync.
- `phase_order` (Orky's separate 9-entry list, which Termhalla mirrors in NO code constant):
  last entry renamed `'human'` → `'human-review'`. Appears only in the committed fixture, the
  provenance comment at `src/shared/orky-status.ts:14-15`, and `docs/features/orky-status.md`.
- NEW top-level blocks: `finding_resolution` (fields `status`/`resolution`/`resolvedBy`/`resolvedAt`,
  the `resolve-finding` command, the integrity human-sign-off rule) and `producer_tiers`
  (tiers/profiled_roles/pinned_roles/judge/ratchet_triggers vocabulary).
- `state.gate_fields` gained `firstAt` (additive; existing normalization tolerates extra fields —
  tolerance is already pinned by the golden `active.json` test's `runs`-map assertion pattern).

## Decisions

1. **Strict version pin at 2** (human call). Bump `EXPECTED_CONTRACT_VERSION` to 2; keep the
   exact-equality check. An older v1 plugin now gets the same one-line warn a v2 plugin gets today —
   log-only observability, never a gate (the module's existing invariant stands). No version-range
   tolerance.
2. **Requirement 4 (`phase_order` reconcile) resolves to fixtures + provenance text only.** Verified:
   no Termhalla code constant mirrors `phase_order`. Update the regenerated fixture (automatic), the
   provenance comment in `src/shared/orky-status.ts` (its quoted 9-entry list ends `'human'`), and the
   matching caveat text in `docs/features/orky-status.md`. `ORKY_PHASES` itself MUST NOT change — the
   CLAUDE.md provenance caveat (gate keys, not `PHASE_ORDER`) was checked and holds; v2 makes the two
   vocabularies agree on the last entry, it does not merge them.
3. **Regenerate all four golden fixtures** (`contract.json`, `state.json`, `active.json`,
   `osc-heartbeat.bin`) with the existing `tools/generate-orky-contract-fixtures.mjs` against the
   installed plugin 0.30.0 — never hand-edit a fixture (they must remain real producer output).
4. **Handshake unit suite updates go through the tests phase** (frozen-test discipline): the
   `goodContract` baseline becomes `contract_version: 2`; the "v2 → mismatch" case inverts to
   "v1 → mismatch" (the mixed-fleet case decision 1 defines); keep a future-version (3) mismatch
   case. TEST-691 (live handshake integration) goes green with no assertion change
   (`contractVersion === EXPECTED_CONTRACT_VERSION`).
5. **Adopt `finding_resolution` for display** (human-elected scope increase over the intake's
   default). Extend `OrkyFindingDetail` with `resolution` / `resolvedBy` / `resolvedAt`
   (nullable, verbatim — same mapping discipline as the existing fields, mapped in
   `orky-root-detail.ts#mapFinding`), and render them on resolved findings in the Orky pane's
   finding rows, following the existing resolved-escalation `— decision: …` precedent
   (`OrkyPane.tsx`). Read-only; no new IPC channels; no `SCHEMA_VERSION` bump (derived display
   data, nothing persisted). The shared `isBlockingFinding` / `openBlockingCount` predicates are
   NOT touched — resolved findings already stop counting via the status check.
6. **`producer_tiers`: not adopted.** Nothing in Termhalla displays producer tiers; per the
   adopt-only-if-displayed rule, mirror nothing (not even types — dead type surface invites
   doc-drift findings).
7. **`firstAt` gate field: no action** beyond the fixture refresh; extra-field tolerance is the
   existing consumer contract.

## Success criteria

- `tests/integration/orky-act-loop.test.ts` TEST-691 passes on a pristine tree against the
  installed plugin (currently the only red test — this feature turns it green).
- Startup handshake logs NO warn line against plugin 0.30.0.
- Full suite green (`npm run build` + `npm test`, the node-app gate profile), including the
  regenerated golden suite and the updated handshake unit suite.
- Resolved findings in the Orky pane show their resolution details; open findings render unchanged.

## Non-goals

- No `.orky/` writes from Termhalla, no pipeline driving (the read-only invariant stands).
- No `producer_tiers` UI or type mirror.
- No decision-queue changes (resolution display is Orky-pane-only for now — see deferred below).
- No handshake behavior change beyond the version constant: still log-only, never a gate, still
  tolerant of absent/pre-contract plugins.

## Concerns (review-routing tags)

- `determinism` — golden fixtures must be reproducible from the live producer; version-pinned
  handshake.
- `doc-drift` — the `phase_order` provenance caveat lives in CLAUDE.md, a source comment, and
  `docs/features/orky-status.md`; all three must stay in agreement.
- `ux` — the new resolved-finding display in the Orky pane (small, precedented, but renderer UI).

(Always-on per config: security, quality, devils-advocate.)

## Open questions

- **resolved** — mixed-version handshake policy → strict pin at 2, warn-only (Kevin, 2026-07-03).
- **resolved** — v2 optional-adoption scope → adopt `finding_resolution` with Orky-pane display;
  skip `producer_tiers` entirely (Kevin, 2026-07-03).
- **deferred** — surface resolution details in the decision-queue drawer rows too? Deferred: the
  queue shows *needs-you* items; resolved findings are history, better suited to the pane's
  full-project view. Revisit if the pane display proves useful.
