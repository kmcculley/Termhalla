# Traceability — 0015-orky-contract-v2-refresh

REQ → TASK matrix (phase 3, amended twice: (1) judgment loopback — TASK-103 fixture regeneration
moved to the TESTS phase / test-designer actor; (2) **ESC-001 descent** — REQ-105/107/108/110
amended, REQ-113 added, new TASK-115..TASK-122; TASK-101..114 stable). `tests` column was filled by
phase 4 (see `traceability.json`); the descent's tests-phase re-entry updates the `tests` arrays for
the amended cases (TEST-719 re-pin, new REQ-110 cases, prose-phrasing scan, optional REQ-113 docs
assertion).

| REQ | Tasks | Files |
|---|---|---|
| REQ-101 — pin bumped to 2, clean v2 handshake | TASK-101, TASK-102 | `src/main/orky/orky-contract-handshake.ts`, `tests/main/orky-cli-contract-handshake.test.ts` |
| REQ-102 — v1 plugin is now the proven mismatch | TASK-102 | `tests/main/orky-cli-contract-handshake.test.ts` |
| REQ-103 — v3 plugin still a mismatch | TASK-102 | `tests/main/orky-cli-contract-handshake.test.ts` |
| REQ-104 — every other handshake invariant preserved | TASK-101, TASK-102 | `src/main/orky/orky-contract-handshake.ts`, `tests/main/orky-cli-contract-handshake.test.ts` |
| REQ-105 *(amended, ESC-001)* — fixtures regenerated; provenance = generation-time recorded producer, no hardcoded numeral required | TASK-103, TASK-104, TASK-105, **TASK-115, TASK-119, TASK-122** | `tests/fixtures/orky-contract/*`, `CHANGELOG.md`, `tests/shared/orky-contract-golden.test.ts`, `tests/docs-feature-0015.test.ts` |
| REQ-106 — `ORKY_PHASES` must not change | TASK-103, TASK-105 | `src/shared/orky-status.ts`, `tests/fixtures/orky-contract/contract.json`, `tests/shared/orky-contract-golden.test.ts` |
| REQ-107 *(amended, ESC-001)* — `phase_order` provenance text reconciled everywhere, incl. prose phrasings (CLAUDE.md:179) | TASK-106, TASK-107, TASK-108, TASK-109, **TASK-117, TASK-118, TASK-122** | `src/shared/orky-status.ts`, `docs/features/orky-status.md`, `docs/features/orky-action-dispatch.md`, `CLAUDE.md`, `tests/docs-feature-0015.test.ts` |
| REQ-108 *(amended, ESC-001)* — TEST-691 green on pristine tree, silent startup handshake, no release-numeral condition | TASK-114, **TASK-122** | `tests/integration/orky-act-loop.test.ts` |
| REQ-109 — `OrkyFindingDetail` carries v2 `finding_resolution` fields | TASK-110, TASK-111, TASK-113 | `src/shared/types.ts`, `src/main/orky/orky-root-detail.ts` |
| REQ-110 *(amended, ESC-001)* — resolution affix: non-empty guard, row-title full-text mirror, resolvedBy label a MAY | TASK-112, **TASK-116, TASK-120, TASK-122** | `src/renderer/components/OrkyPane.tsx`, `tests/renderer/orky-pane-resolution-structure.test.ts`, `tests/e2e/orky-pane-resolution.spec.ts` |
| REQ-111 — blocking predicates untouched | TASK-113, **TASK-122** | `src/shared/orky-status.ts` |
| REQ-112 — scope guards: no `producer_tiers`, no writes, no new channels | TASK-113, **TASK-122** | `src/shared/ipc-contract.ts`, `src/shared/types.ts`, `src/main/ipc/` |
| REQ-113 *(added, ESC-001)* — orky-pane.md documents the resolution display | **TASK-121** | `docs/features/orky-pane.md` |

## Coverage check

Every REQ-101..REQ-113 maps to at least one TASK above. Uncovered REQs: none. (The ESC-001 descent
added REQ-113 → TASK-121 and mapped every amended REQ to descent tasks; no coverage removed.)

## Task index

| Task | Phase / actor | Gist | Depends on |
|---|---|---|---|
| TASK-101 | implement — done | Bump `EXPECTED_CONTRACT_VERSION` 1→2 | — |
| TASK-102 | tests (test-designer) — done | Update handshake unit suite: goodContract→v2, invert mismatch case to v1, keep v3 case | TASK-101 (sequencing) |
| TASK-103 | tests (test-designer) — done, moved by loopback amendment | Regenerate all 4 golden fixtures in one tool run against the installed v2-contract plugin (recorded fact: 0.32.0 @`1c59d74`), pre-freeze; never hand-edited | — |
| TASK-104 | implement — done (wording corrected by TASK-119) | Record regeneration provenance in CHANGELOG | TASK-103 |
| TASK-105 | tests + implement re-check — done | Verify golden test passes unmodified against new fixtures | TASK-103 |
| TASK-106 | implement — done | Rewrite `orky-status.ts` provenance comment (phase_order text, resolved-historical framing) | — |
| TASK-107 | implement — done | Update `docs/features/orky-status.md` provenance caveat | — |
| TASK-108 | implement — done | Fix stale "expected 1" in `docs/features/orky-action-dispatch.md` | — |
| TASK-109 | implement — done (scan (4) added, re-run in TASK-122) | Run CONV-023 doc-drift verification greps | TASK-106, TASK-107, TASK-108 |
| TASK-110 | implement — done | Add `resolution`/`resolvedBy`/`resolvedAt` to `OrkyFindingDetail` | — |
| TASK-111 | implement — done | Map new fields in `mapFinding` (reuse `epochOrNull`) | TASK-110 |
| TASK-112 | implement — done (guard/title superseded in part by TASK-120) | Render resolution affix on resolved findings in `OrkyPane.tsx` | TASK-110, TASK-111 |
| TASK-113 | implement — done (re-run over descent delta in TASK-122) | Scope-guard verification incl. freeze boundary | TASK-110, TASK-111, TASK-112 |
| TASK-114 | implement — done (re-run as TASK-122) | Full node-app gate + TEST-691 green + golden suite unmodified | all prior tasks |
| **TASK-115** | **tests (test-designer) — ESC-001 descent** | Amend TEST-719: drop `toContain('0.30.0')`; assert generation-time producer (0.32.0/`1c59d74` recorded fact) or version-agnostic `regenerated against plugin <semver> (commit <sha>)` shape; no hardcoded spec-time numeral required | — |
| **TASK-116** | **tests (test-designer) — ESC-001 descent** | Extend frozen REQ-110 tests: (a) row `title` mirrors claim + full affix when affix renders; (b) `resolution: ''` → no affix, no dangling label (even with non-null resolvedBy/resolvedAt) | — |
| **TASK-117** | **tests (test-designer) — ESC-001 descent** | Encode REQ-107 prose-phrasing scan (4) (`intake.{1,5}human`) as a docs-test assertion — CLAUDE.md:179 guard; scans (1)–(3) stay review-time greps; optional REQ-113 docs assertion | — |
| **TASK-118** | **implement — ESC-001 descent** | Fix CLAUDE.md:179 "(intake…human)" → "(intake…human-review)" (version-aware phrasing) | TASK-117 |
| **TASK-119** | **implement — ESC-001 descent** | Reword CHANGELOG provenance lead: generation-time producer 0.32.0 (@`1c59d74`) as recorded fact; 0.30.0 demoted to spec-time historical mention | TASK-115 |
| **TASK-120** | **implement — ESC-001 descent** | OrkyPane.tsx: non-empty resolution guard; compose affix once; row `title` = claim + affix when affix renders; MAY label `by <resolvedBy>` | TASK-116 |
| **TASK-121** | **implement — ESC-001 descent** | New `docs/features/orky-pane.md` section: three `OrkyFindingDetail` fields + affix guards + tooltip mirror (REQ-113) | TASK-120 |
| **TASK-122** | **implement — ESC-001 descent** | Descent terminal gate: CONV-023 greps incl. scan (4), scope guards over the delta (incl. tests/ freeze boundary), full `npm run build && npm test` with TEST-691 unchanged and the amended suite GREEN | TASK-115..TASK-121 |
