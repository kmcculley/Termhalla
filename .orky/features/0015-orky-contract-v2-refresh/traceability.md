# Traceability — 0015-orky-contract-v2-refresh

REQ → TASK matrix (phase 3, amended after the judgment loopback: TASK-103 fixture regeneration moved
to the TESTS phase / test-designer actor; REQ↔TASK↔file coverage is unchanged). `tests` column was
filled by phase 4 (see `traceability.json`).

| REQ | Tasks | Files |
|---|---|---|
| REQ-101 — pin bumped to 2, clean v2 handshake | TASK-101, TASK-102 | `src/main/orky/orky-contract-handshake.ts`, `tests/main/orky-cli-contract-handshake.test.ts` |
| REQ-102 — v1 plugin is now the proven mismatch | TASK-102 | `tests/main/orky-cli-contract-handshake.test.ts` |
| REQ-103 — v3 plugin still a mismatch | TASK-102 | `tests/main/orky-cli-contract-handshake.test.ts` |
| REQ-104 — every other handshake invariant preserved | TASK-101, TASK-102 | `src/main/orky/orky-contract-handshake.ts`, `tests/main/orky-cli-contract-handshake.test.ts` |
| REQ-105 — golden fixtures regenerated, never hand-edited | TASK-103, TASK-104, TASK-105 | `tests/fixtures/orky-contract/*`, `CHANGELOG.md`, `tests/shared/orky-contract-golden.test.ts` |
| REQ-106 — `ORKY_PHASES` must not change | TASK-103, TASK-105 | `src/shared/orky-status.ts`, `tests/fixtures/orky-contract/contract.json`, `tests/shared/orky-contract-golden.test.ts` |
| REQ-107 — `phase_order` provenance text reconciled everywhere | TASK-106, TASK-107, TASK-108, TASK-109 | `src/shared/orky-status.ts`, `docs/features/orky-status.md`, `docs/features/orky-action-dispatch.md` |
| REQ-108 — TEST-691 green on pristine tree, silent startup handshake | TASK-114 | `tests/integration/orky-act-loop.test.ts` |
| REQ-109 — `OrkyFindingDetail` carries v2 `finding_resolution` fields | TASK-110, TASK-111, TASK-113 | `src/shared/types.ts`, `src/main/orky/orky-root-detail.ts` |
| REQ-110 — Orky pane displays resolution on resolved findings only | TASK-112 | `src/renderer/components/OrkyPane.tsx` |
| REQ-111 — blocking predicates untouched | TASK-113 | `src/shared/orky-status.ts` |
| REQ-112 — scope guards: no `producer_tiers`, no writes, no new channels | TASK-113 | `src/shared/ipc-contract.ts`, `src/shared/types.ts`, `src/main/ipc/` |

## Coverage check

Every REQ-101..REQ-112 maps to at least one TASK above. Uncovered REQs: none. (Unchanged by the
amendment — TASK-103/TASK-105 changed phase ownership, not REQ coverage.)

## Task index

| Task | Phase / actor | Gist | Depends on |
|---|---|---|---|
| TASK-101 | implement | Bump `EXPECTED_CONTRACT_VERSION` 1→2 | — |
| TASK-102 | tests (test-designer) | Update handshake unit suite: goodContract→v2, invert mismatch case to v1, keep v3 case | TASK-101 (sequencing) |
| TASK-103 | **tests (test-designer) — moved by loopback amendment** | Regenerate all 4 golden fixtures in one tool run against plugin 0.30.0, BEFORE the tests-gate freeze snapshot; never hand-edited; TEST-711 going green in-phase is expected (suite stays RED overall) | — |
| TASK-104 | implement | Record regeneration provenance in CHANGELOG | TASK-103 |
| TASK-105 | tests (initial) + implement (TASK-114 re-check) | Verify golden test passes unmodified against new fixtures — first at the tests-phase re-run, re-confirmed at the terminal gate | TASK-103 |
| TASK-106 | implement | Rewrite `orky-status.ts` provenance comment (phase_order text, resolved-historical framing) | — |
| TASK-107 | implement | Update `docs/features/orky-status.md` provenance caveat | — |
| TASK-108 | implement | Fix stale "expected 1" in `docs/features/orky-action-dispatch.md` | — |
| TASK-109 | implement | Run CONV-023 doc-drift verification greps | TASK-106, TASK-107, TASK-108 |
| TASK-110 | implement | Add `resolution`/`resolvedBy`/`resolvedAt` to `OrkyFindingDetail` | — |
| TASK-111 | implement | Map new fields in `mapFinding` (reuse `epochOrNull`) | TASK-110 |
| TASK-112 | implement | Render resolution affix on resolved findings in `OrkyPane.tsx` | TASK-110, TASK-111 |
| TASK-113 | implement | Scope-guard verification (predicates untouched, no producer_tiers, no new channels/schema bump, **implement diff touches nothing under `tests/`**) | TASK-110, TASK-111, TASK-112 |
| TASK-114 | implement | Full node-app gate + TEST-691 green + golden suite unmodified, terminal acceptance | all prior tasks |
