# 0014 — Orky OSC heartbeat: review follow-ups

Deferred/open findings from `.orky/features/0014-orky-osc-heartbeat/findings.json` as of the doc-sync
pass that closed FINDING-QUAL-004 and FINDING-QUAL-005. This feature shipped the Termhalla-side parser
+ renderer for Orky's real ADR-026 OSC heartbeat contract (`\x1b]9999;<json>\x07`); see
[orky-osc-heartbeat.md](../features/orky-osc-heartbeat.md) for the current, correct contract and
architecture. The items below are tracked but **not blocking** — none is `contract_violation: true`
and open at this point.

| ID | Severity | Summary |
|---|---|---|
| FINDING-DA-001 | MEDIUM | Stream-derived status is unauthenticated (any PTY writer can fabricate a heartbeat, incl. a fake `needsHuman:true`). Deliberate design tradeoff (REQ-004 thin-client stance), now documented in the feature doc's "Trust boundary" section. Open: visually distinguishing stream-derived from filesystem-derived status in the chip UI is not yet implemented. |
| FINDING-DA-002 | MEDIUM | REQ-013's "filesystem wins" guarantee holds spatially but not temporally — `OrkyTracker.watch()`'s async startup window and `unwatch()`'s fs-null emit can let a local pane's stream-derived status briefly override/mask the filesystem-owned one. |
| FINDING-DA-005 | MEDIUM | The stream path has no staleness/expiry — `lastActivityAt` is hard-coded to 0, so a heartbeat from a since-exited/idle SSH session stays pinned indefinitely, indistinguishable from a live run. The filesystem path has `STALL_THRESHOLD_MS`/`isStalled`; the stream path has no equivalent. |
| ~~FINDING-DA-006~~ | LOW | **RESOLVED upstream 2026-07-12** (Orky v0.44.0, commit `9443bee`): Orky's `docs/osc-heartbeat.md` now states the never-redefine-rename-instead evolution discipline this finding asked for — a field's meaning is frozen forever; within `v:1` the schema may only gain fields; a meaning change must introduce a new field name (a `v` bump signals a structural break, never permission to reuse a name) — explicitly citing that version negotiation cannot protect a decode-everything consumer (Termhalla's frozen TEST-011). Termhalla's forward-compat decode is unchanged; the feature doc's drift-caveat bullet updated. `findings.json` closed via `resolve-finding`. |
| FINDING-DA-007-OSC | LOW | `decodeHeartbeat` maps an empty-string `feature` to `""`, not `null` — bypasses the app-loop/cleared-shape path and can render a blank-name chip. |
| FINDING-DA-008 | LOW | `orky-stream-status.ts` and `orky-status.ts`'s `selectOrkyPaneStatus` header comments still cite the old 13-REQ numbering (REQ-008/009/013 instead of the current REQ-012/013/017). |
| FINDING-DA-009 | LOW | On the stream path, a `phase:null` heartbeat with incomplete gates (`gateN < gateM`, `kind: 'busy'`) still renders the chip label/detail as containing the literal word "done" via the `?? 'done'` fallback — a self-contradictory presentation (`kind` is correctly gate-based post-ESC-002, but the label fallback's `null => done` assumption doesn't hold on the stream path the way it does on 0004's filesystem `gateFrontier` path). Real-wire impact is nil today (the real emitter only sends `phase:null` when gates are already complete) but the risk is latent for a drifted/spoofed heartbeat. Proposed convention (not yet promoted): a derived status label must not render a completeness word unless the completeness signal it's actually derived from (gate fullness) holds. |
| FINDING-DET-001 | MEDIUM | `OrkyStreamStatusBridge` — the only order-sensitive component, and the actual production applier of the fs-wins precedence — has no behavioral test (only the pure `selectOrkyPaneStatus` rule is unit-tested). |
| FINDING-DET-002 | LOW | The `MAX_PENDING_BYTES` reset (REQ-006) can, depending on exact chunk-boundary timing, swallow a later valid marker after an unterminated-prefix flood — same on-the-wire bytes could light a status chip on one run/host and not another. Bounded, LOW-severity (read-only cosmetic status, adversarial input class). |
| FINDING-QUAL-002 | MEDIUM | `heartbeatToFeatureStatus` force-casts `OrkyHeartbeat.phase` (typed `OrkyPhase \| string \| null`) into `OrkyFeatureStatus.phase`'s narrower closed union via `as`. Currently harmless (never switched on) but misrepresents the type system's guarantee. |
| FINDING-QUAL-003 | LOW | `chipLabel` and `heartbeatDetail` both independently encode the same "null phase renders as 'done'" convention (`?? 'done'`), not centralized in a shared helper. |
| FINDING-DD-001 | MEDIUM | `state.json`'s traceability block is stale (phantom `TEST-042`, wrong `reqsWithoutUnitTests`, phantom `TASK-010`). Out of doc-sync's scope — orchestrator-owned. |
| FINDING-DD-002 | LOW | Three test files still carry present-tense "Runs RED: ... implements the superseded 8888/key=value contract" header comments, now false (suite is GREEN, parser implements 9999/JSON). Out of doc-sync's scope — test file edits require a fresh test-designer dispatch. |
| FINDING-DD-003 | LOW | `tests/shared/orky-heartbeat-status.test.ts:6`'s file-header comment still lists `phase` among `kind`'s derivation inputs, contradicting the file's own ESC-002 iteration note (`kind` is gate-only). Out of doc-sync's scope — test file edit. |

## Closed this pass (doc-sync)

- **FINDING-QUAL-004** (HIGH, contract_violation) — `docs/features/orky-osc-heartbeat.md` and
  `CHANGELOG.md` rewritten from the superseded `8888`/key=value placeholder contract to the real,
  shipped ADR-026 `\x1b]9999;<json>\x07` contract, with a new "Trust boundary" subsection folding in
  FINDING-DA-001's caveat and an updated "Scope: Orky-side emission is REAL and shipped" section.
- **FINDING-QUAL-005** (MEDIUM) — `src/shared/types.ts:71`'s `OrkyHeartbeat.phase` inline comment
  updated to the corrected, disambiguated wording used elsewhere in this iteration's diff (comment-only
  change, no logic touched).
