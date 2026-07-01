# 0005 — Cross-project Orky registry + multi-root aggregation — Traceability (Phase 3 plan / Phase 4 tests)

REQ → TASK → TEST matrix, the human-readable rendering of `traceability.json`. Every REQ (REQ-001…REQ-023)
maps to ≥1 TASK; the `traceability-plan` gate enforces this mechanically. The `TEST(s)` column was filled
in phase 4 ([`04-tests.md`](04-tests.md)) — see that doc for the full TEST-ID → assertion catalogue and the
chosen contracts where the spec/plan were silent on exact shape.

| REQ | Summary | TASK(s) | TEST(s) | Files (primary) |
|---|---|---|---|---|
| REQ-001 | Cross-project registry service generalizes the single-root tracker to a set of roots, reusing `findOrkyRoot` + the shared mappers, single app-wide instance, disposable, read-only | TASK-005, TASK-006, TASK-007, TASK-011 | TEST-088, TEST-089, TEST-112, TEST-147 | `orky-root-engine.ts`, `orky-tracker.ts`, `orky-registry.ts`, `services.ts` |
| REQ-002 | Membership = union of open-pane roots ∪ persisted explicit list, de-duplicated by resolved root, `source` provenance | TASK-002, TASK-007, TASK-008, TASK-009 | TEST-058, TEST-059, TEST-060, TEST-061, TEST-107, TEST-108, TEST-112, TEST-113, TEST-140, TEST-141, TEST-142, TEST-144, TEST-145 | `orky-registry.ts` (shared), `orky-registry.ts` (main), `window-manager.ts`, `register-orky.ts` |
| REQ-003 | Open-pane roots are ephemeral (D2): a pane-only root leaves the aggregate when its last pane closes; never auto-persisted | TASK-007, TASK-009 | TEST-115, TEST-116, TEST-143 | `orky-registry.ts`, `register-orky.ts` |
| REQ-004 | Persisted explicit list is manual + durable, contributes independently of any open pane | TASK-007 | TEST-117, TEST-118 | `orky-registry.ts` |
| REQ-005 | Per-root status reuses 0004's pure mappers verbatim (D3) — no fork, no new status type | TASK-005 | TEST-089, TEST-090 | `orky-root-engine.ts` |
| REQ-006 | Aggregate entry shape `{root, source, status}`; `root` = project root (not `.orky/` subdir) | TASK-001, TASK-002, TASK-007 | TEST-062, TEST-063, TEST-066, TEST-067, TEST-105, TEST-114 | `types.ts`, `orky-registry.ts` (shared), `orky-registry.ts` (main) |
| REQ-007 | Deterministic, stable codepoint-sorted snapshot ordering (never `localeCompare`) | TASK-002 | TEST-064, TEST-065, TEST-066, TEST-067 | `orky-registry.ts` (shared) |
| REQ-008 | `registry:status` carries the COMPLETE current aggregate on every emit, never a diff | TASK-007, TASK-011 | TEST-119, TEST-137 | `orky-registry.ts` (main), `register-registry.ts` |
| REQ-009 | `registry:addRoot` validates + adds a normalized root, idempotent, persists, tracks, emits | TASK-003, TASK-007, TASK-011 | TEST-072, TEST-076, TEST-077, TEST-120, TEST-121, TEST-135 | `validate-root.ts`, `orky-registry.ts`, `register-registry.ts` |
| REQ-010 | `registry:removeRoot` removes a persisted root, idempotent no-op on absent root, never throws | TASK-007, TASK-011 | TEST-122, TEST-123, TEST-124, TEST-136 | `orky-registry.ts`, `register-registry.ts` |
| REQ-011 | `registry:current` pulls the current aggregate snapshot, pure read | TASK-007, TASK-011 | TEST-125, TEST-134 | `orky-registry.ts`, `register-registry.ts` |
| REQ-012 | `registry:roots` pulls the persisted explicit list only (not pane-only roots), pure read | TASK-007, TASK-011 | TEST-126, TEST-134 | `orky-registry.ts`, `register-registry.ts` |
| REQ-013 | Persisted storage: new self-versioned `orky-registry.json` (`{version:1, roots:[]}`), atomic write, corrupt-tolerant, `SCHEMA_VERSION` untouched | TASK-004 | TEST-078..TEST-087, TEST-132 | `orky-registry-store.ts` |
| REQ-014 | One shared chokidar watcher + re-read per resolved root across ALL consumers (pane-chip AND registry) | TASK-005, TASK-006, TASK-011 | TEST-097, TEST-098, TEST-099, TEST-100, TEST-131 | `orky-root-engine.ts`, `orky-tracker.ts`, `register.ts` |
| REQ-015 | Per-root read-path bounds (`MAX_FEATURE_DIRS`, `MAX_FILE_BYTES`) + symlink guard apply to EVERY root | TASK-005 | TEST-101, TEST-102, TEST-103 | `orky-root-engine.ts` |
| REQ-016 | Add/remove IPC boundary: input validation, path safety, no traversal, per-window sender discipline | TASK-003, TASK-008, TASK-009, TASK-011 | TEST-071, TEST-073, TEST-074, TEST-075, TEST-109, TEST-110, TEST-121, TEST-135, TEST-139, TEST-141 | `validate-root.ts`, `window-manager.ts`, `register-orky.ts`, `register-registry.ts` |
| REQ-017 | Strictly read-only under `.orky/`; the only persisted write is `orky-registry.json`; no CLI spawn | TASK-004, TASK-005, TASK-007 | TEST-086, TEST-095, TEST-096 | `orky-registry-store.ts`, `orky-root-engine.ts`, `orky-registry.ts` |
| REQ-018 | Robust to missing/partial/malformed per-root state; one bad root never breaks the aggregate | TASK-005, TASK-007 | TEST-104, TEST-105, TEST-106, TEST-127, TEST-128 | `orky-root-engine.ts`, `orky-registry.ts` |
| REQ-019 | Race-safe (session-identity pattern), disposable, leak-free — no lingering watchers/timers | TASK-005, TASK-006, TASK-007 | TEST-091, TEST-092, TEST-093, TEST-094, TEST-129, TEST-130 | `orky-root-engine.ts`, `orky-tracker.ts`, `orky-registry.ts` |
| REQ-020 | Single app-wide instance; `registry:status` broadcast to all windows; no per-window duplication | TASK-007, TASK-008, TASK-009, TASK-011 | TEST-108, TEST-111, TEST-131, TEST-137, TEST-140, TEST-141 | `orky-registry.ts`, `window-manager.ts`, `register-orky.ts`, `register-registry.ts` |
| REQ-021 | No renderer UI ships in this feature (IPC/data-only, D1) | TASK-012 | TEST-070 | `preload/index.ts`, `renderer/api.ts` |
| REQ-022 | IPC contract wiring follows the existing per-domain registrar pattern; pushes via `send`/`safeSend` | TASK-010, TASK-011, TASK-012 | TEST-068, TEST-069, TEST-111, TEST-133, TEST-137, TEST-138 | `ipc-contract.ts`, `register-registry.ts`, `register.ts`, `preload/index.ts` |
| REQ-023 | Documentation reconciled: feature doc, CLAUDE.md link, CHANGELOG, `.orky/baseline/architecture.md` | TASK-013 | TEST-146 | `docs/features/orky-status.md`, `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md` |

## Coverage check

All 23 requirements (REQ-001…REQ-023) map to at least one TASK and at least one TEST. No REQ left
uncovered; no open issue deferred (see `03-plan.md` "Open issues" — none).
