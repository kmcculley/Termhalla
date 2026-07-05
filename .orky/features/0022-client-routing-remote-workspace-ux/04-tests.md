# Tests — 0022-client-routing-remote-workspace-ux (F21)

**Phase:** 4 (tests). Test-id block: **TEST-2201..TEST-2280** (feature-number-keyed, the
0016/0018/0020/0021 convention; no collision — repo-wide grep `TEST-22[0-9][0-9]` had zero
4-digit hits at authoring time).

**Producer note:** test-designer ran driver-inline (no parallel agent-dispatch tool in this
driver environment — the 0016..0021 precedent). The implementer is a different dispatch.

## Suites (all vitest `tests/**/*.test.ts` unless marked e2e)

| File | Tests | Covers |
|---|---|---|
| `tests/shared/remote-home.test.ts` | TEST-2201..2206 (normalize), TEST-2207/2276/2208 (allowed domains), TEST-2209 (move refusal) | REQ-001, REQ-017, REQ-018 |
| `tests/shared/remote-workspace-migration.test.ts` | TEST-2210..2217 | REQ-002, REQ-001 (application points, CONV-026) |
| `tests/main/remote-agent-artifact.test.ts` | TEST-2218..2221 | REQ-006 (version identity, dev/packaged resolver, extraResources) |
| `tests/main/remote-agents-io.test.ts` | TEST-2222..2225 | REQ-004 (registry IO seam; no-secrets; honest failure) |
| `tests/main/remote-manager-lifecycle.test.ts` | TEST-2226..2235 | REQ-006, REQ-007, REQ-012, REQ-013, REQ-014 |
| `tests/main/remote-manager-flow.test.ts` | TEST-2236..2241 | REQ-009 (fresh policy per connection; cadence; CONV-036 quiet flush; no window frames) |
| `tests/main/remote-manager-routing.test.ts` | TEST-2242..2253 | REQ-008, REQ-010, REQ-011, REQ-013 |
| `tests/main/register-remote.test.ts` | TEST-2254..2257 | REQ-005, REQ-004, REQ-008/REQ-019 (delegation pins), REQ-010/REQ-006 (composition) |
| `tests/renderer/remote-slice.test.ts` | TEST-2258..2262, TEST-2277 | REQ-014, REQ-016 (toast policy), REQ-004 |
| `tests/renderer/remote-ux-structure.test.ts` | TEST-2263..2270 (2265 folded into 2264; see map) | REQ-016, REQ-017, REQ-011, REQ-015, REQ-018 |
| `tests/docs-feature-0022.test.ts` | TEST-2278..2280 | REQ-020 |
| `tests/e2e/remote-workspace.spec.ts` (e2e — NOT in the `npm test` gate) | TEST-2272..2275 | REQ-015, REQ-016, REQ-017, REQ-013, REQ-002 |

Shared harness: `tests/main/remote-manager-harness.ts` (freezes the manager DI contract; stub
wire + fake scheduler; `connectResults` failure presets).

## TEST → REQ map

| TEST | REQ | Assertion |
|---|---|---|
| TEST-2201..2206 | REQ-001 | normalizeWorkspaceHome: local defaults, wrong-kind, pass-through, coerce-remote (never silently local), key stripping, never-throws |
| TEST-2207/2276/2208 | REQ-017 | remoteAllowedDomains: local='all' / connected=advertised / else=['pty'] |
| TEST-2209 | REQ-018 | paneMoveRefusalReason: local↔local ok; all cross-home + remote→remote refused actionably |
| TEST-2210..2214 | REQ-002 | SCHEMA_VERSION=9; v6/v7/v8 load unchanged; v9 round-trip fixpoint; idempotent+deterministic; v10 rejected |
| TEST-2215..2217 | REQ-001 | malformed home coerced at BOTH deserialization doors (file load + template instantiation) |
| TEST-2218..2221 | REQ-006 | MANIFEST_VERSION = package.json version; dev/packaged artifact paths; extraResources ships the bundle |
| TEST-2222..2225 | REQ-004 | agents IO: missing→[], normalize both doors, no secret persisted, save rejects on disk failure |
| TEST-2226..2229 | REQ-006/REQ-014 | connecting→connected pushes; coalesced concurrent connects; unknown/empty agentId refused actionably |
| TEST-2230..2232 | REQ-007 | cancel aborts in-flight connect (signal observed); diagnostics pass through unweakened; stop() aborts + kills |
| TEST-2233 | REQ-012 | lease:revoked → disconnected/lease-stolen once; post-revocation frames ignored |
| TEST-2234..2235 | REQ-013 | exit classification (0→agent-exited, else connection-lost); terminal reason never overwritten; fresh reconnect attempt |
| TEST-2236..2241 | REQ-009 | ack cadence (64 KiB default), scheduled quiet-flush (CONV-036), FRESH policy per reconnect (the weld), pane-exit prune, zero window frames |
| TEST-2242..2248 | REQ-008 | exact spawn params (launch/envId stripped), '' cwd, live-adopt/exited-refuse (FINDING-004), CH-derived methods + bare-id kill, redundant-resize suppression, disconnected drops |
| TEST-2249..2250 | REQ-010/REQ-011 | evt→send 1:1 + prune on exit; status pass-through with absent lastExit KEY |
| TEST-2251..2253 | REQ-013 | sorted attach, \x1bc+snapshot exactly once, dims-then-recorded-resize, empty-inventory exits (v1 reality), app-start attach-or-spawn |
| TEST-2254 | REQ-005 | six remote:* channels; PtySpawnArgs.remote optional; api methods; preload bridge |
| TEST-2255 | REQ-004/REQ-005 | registrar: list/save via injected IO; current via manager; connect/disconnect fire-and-forget |
| TEST-2256 | REQ-019/REQ-008 | register-pty delegation: remote branch precedes local stack; ops probe remote ownership first (CONV-032-anchored) |
| TEST-2257 | REQ-010/REQ-006 | register.ts composes registerRemote; services constructs ONE manager; stop wired |
| TEST-2258 | REQ-014 | push upsert; recovery pull fills only unbeaten workspaces |
| TEST-2259 | REQ-016 | disconnected-transition toast policy (error once; cancelled silent; no repeat) |
| TEST-2260 | REQ-014 | CONV-011 pruning |
| TEST-2261..2262 | REQ-004 | named-agent save/load honesty (returned normalized list; failure toast) |
| TEST-2277 | REQ-014 | connect/disconnect bridge passthrough |
| TEST-2263 | REQ-016/REQ-012 | banner view-model: null/connecting-cancel/lease-copy/diagnostic detail/no-state case |
| TEST-2264 | REQ-016 | WorkspaceView mounts banner; frozen testids; no portal |
| TEST-2266 | REQ-017 | remote-gates pure derivations |
| TEST-2267 | REQ-017/REQ-011 | gate consumers wired (SplitMenu, WorkspaceView, TerminalPane recStart, Usage/Orky watchers) |
| TEST-2268 | REQ-015 | newRemoteWorkspace: agent home + '' cwd terminal + reportAssignment (0011 FINDING-001) |
| TEST-2269 | REQ-015 | TemplatesMenu row + palette action + picker testid |
| TEST-2270 | REQ-018 | move guard precedes any mutation |
| TEST-2278..2280 | REQ-020 | feature doc, CLAUDE.md row, upstream follow-up discharge notes |
| TEST-2272..2275 (e2e) | REQ-015/REQ-016/REQ-017/REQ-013/REQ-002 | single-gesture create (schema 9 + home persisted), disconnected banner + keep-mounted pane, kind-button greying, reconnect re-arm + local intact |

## TASK-017 — the sanctioned frozen-suite amendments (executed THIS phase, CONV-019/CONV-022)

- `tests/remote-protocol-guards.test.ts` TEST-746 — SUPERSEDED to preload/renderer-only
  confinement (src/main hosts the sanctioned consumer); header updated.
- `tests/remote-client-structure.test.ts` TEST-2001 guard — same supersession.
- SCHEMA_VERSION re-pins 8→9 (each cites 0022 REQ-002): TEST-559
  (orky-needs-you-quickstore), TEST-038 (orky-osc-structural), TEST-087 (orky-registry-store),
  TEST-008 (quick-store-toasts), TEST-344 (decision-queue-panel-structure), TEST-001
  (minimize-persistence), TEST-375 + TEST-377 (orky-pane-migration), TEST-020 (orky-status),
  TEST-671 (orky-cockpit-structure, the `SCHEMA_VERSION = 9` source pin + title).
- e2e stamps: `tests/e2e/orky-cockpit.spec.ts`, `tests/e2e/orky-pane.spec.ts` (`schemaVersion`
  8→9 — run under `npm run e2e` only; witness obligation per CONV-052 rides the review phase
  together with TEST-2272..2275).

## RED verification (CONV-059)

`npm test` exit 1 — VERIFIED 2026-07-04 (vitest json reporter): 20 failed files / 1788 passing
tests untouched, and the failing set is EXACTLY the feature's own new + amended suites:

New 0022 suites (11): `tests/docs-feature-0022.test.ts`, `tests/main/register-remote.test.ts`,
`tests/main/remote-agent-artifact.test.ts`, `tests/main/remote-agents-io.test.ts`,
`tests/main/remote-manager-flow.test.ts`, `tests/main/remote-manager-lifecycle.test.ts`,
`tests/main/remote-manager-routing.test.ts`, `tests/renderer/remote-slice.test.ts`,
`tests/renderer/remote-ux-structure.test.ts`, `tests/shared/remote-home.test.ts`,
`tests/shared/remote-workspace-migration.test.ts`.

Amended-pin suites (9, all failing ONLY on the 8→9 re-pin): `tests/main/orky-needs-you-quickstore.test.ts`,
`tests/main/orky-osc-structural.test.ts`, `tests/main/orky-registry-store.test.ts`,
`tests/main/quick-store-toasts.test.ts`, `tests/renderer/decision-queue-panel-structure.test.ts`,
`tests/renderer/orky-cockpit-structure.test.ts`, `tests/shared/minimize-persistence.test.ts`,
`tests/shared/orky-pane-migration.test.ts`, `tests/shared/orky-status.test.ts`.

No pre-existing suite fails for any other reason (the TEST-746/TEST-2001 supersessions stay
GREEN by construction — no preload/renderer consumer exists yet).

## AMENDED at the 2026-07-04 implement→tests loopback (CONV-019 discipline)

The first implementation pass surfaced four items; the tests-phase actor executed the test-side
fixes with every assertion's INTENT byte-unchanged:

1. **TEST-2227 (authoring defect, the 0021 TEST-2105 class):** the harness's `...over` spread let a
   test-supplied `connect` REPLACE the counted spy, so `h.connect` measured nothing.
   `remote-manager-harness.ts` now wraps any override INSIDE the counted `vi.fn`.
2. **TEST-2251 (authoring defect):** the rig served the after-reconnect inventory to the FIRST
   connection too — a correct inventory-driven client legitimately attaches at connection 1, making
   the exactly-once counts read 2. The rig's inventory now starts empty and is populated in-place
   after the first wire dies.
3. **TEST-741 + `CAPABILITY_IDS` (the prescribed same-change amendment):** `register-remote.ts`
   grew the registrar partition 17→18, so `remote` joined the vocabulary and the derivation counts
   re-pinned (17→18, 18→19) — exactly the amendment path TEST-741's header names.
4. **TEST-746 successor guard (latent prefix collision, CONV-037):** the `shared/remote` key also
   matched the renderer-legal pure models (`shared/remote-agents|home|workspace`); re-keyed on the
   protocol DIRECTORY `shared/remote/`.
5. **TEST-379 (the CONV-059 assembled needle):** a rejection-of-9 pin no 8→9 grep could see — the
   red run caught it; re-pinned at 10 (the invariant: newer-than-current rejected).

**Red set at the re-freeze:** `tests/docs-feature-0022.test.ts` (docs land at implement, TASK-016)
plus `tests/renderer/theme-var-validity.test.ts` — the latter is a REAL implementation defect the
red run caught (RemoteBanner referenced an undefined `--panel-bg` token, CONV-029); the fix is
production-code-only (`RemoteBanner.tsx` → the established `--elevated` token) and belongs to the
implement phase, which the tests actor must not touch.

## Trade-offs / notes for the implementer

- The manager suites FREEZE the DI contract in `remote-manager-harness.ts` — implement to it.
- TEST-2251 pins `\x1bc` as the reset preamble ahead of the attach snapshot.
- TEST-2246 pins pty:kill's BARE-string wire params (the F16 contract).
- TEST-2259/2263 pin user-facing copy LOOSELY (regex/length), never exact prose.
- e2e uses an `.invalid` host: assertions pin the disconnected STATE, never one reason string.
