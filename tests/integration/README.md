# App-level integration suites (Termhalla × Orky, features F5–F14)

Cross-feature / end-to-end tests written at the app-level INTEGRATION phase, **after** all ten
roadmap features (F5–F14) were built and individually gated. They prove the features work
*together* — against a synthetic multi-project `.orky/` fixture and, for every write, against the
**real** Orky CLIs — and they are strictly **additive**: no frozen per-feature suite is touched.
They run under the same `npm test` (vitest) command as the unit suites.

## Files

| File | TEST ids | Span |
| --- | --- | --- |
| `orky-fixture.ts` | — | shared fixture builder (3 projects: `alpha` pane-less/persisted with an open escalation + feedback disabled; `bravo` pane+persisted with an awaiting-human-review feature, an escalated feature, feedback enabled file-mode; `charlie` pane-only, clean/idle) + tree-hash boundary helpers |
| `orky-read-loop.test.ts` | TEST-684..690 | F5 × F6 × F9 × F11 × F13 × 0004 (`OrkyTracker`/`findOrkyRoot`/`orky:status`), all real wiring (shared `OrkyRootEngine`, real chokidar, real `OrkyRegistryStore`) |
| `orky-act-loop.test.ts` | TEST-691..702 | F6/F8/F10/F12 → F7 → the **REAL** `gatekeeper`/`feedback` CLIs → ground truth re-read (F9 detail, F5 watcher, F6 queue) |
| `orky-osc-loop.test.ts` | TEST-703..706 | F14 parser against the **REAL** `gatekeeper osc-heartbeat` emitter; parity with the filesystem path; `selectOrkyPaneStatus` precedence |

## What the load-bearing invariant proofs look like

The read/write boundary ("only F7 writes under `.orky/`, and only via the sanctioned
feedback/gatekeeper contract on an explicit gesture") is asserted twice:

- **Behaviorally** — every fixture `.orky/` tree is content-hashed before/after. The read loop
  (TEST-689) must leave all three trees byte-identical; the act loop (TEST-702) must produce a
  changed/added file set that is *exactly* the sanctioned CLI-written set (Gatekeeper-mutated
  `state.json`, feedback `outbox`/`inbox`/`applied.jsonl`, `backlog.jsonl`) with the untouched
  project byte-identical. The OSC emitter runs are also hash-checked (TEST-703/705).
- **Structurally** — TEST-690 scans the read-path modules: their `fs` imports must be read-only
  primitives, no `child_process` anywhere, and `orky-cli-runner` (the only Orky-CLI exec wrapper)
  may be imported only by F7's dispatcher and the read-only contract handshake.

## Real-CLI round trips (the pipeline's thesis)

- `resolveEscalation` with feedback **disabled** falls through to the real
  `gatekeeper resolve-escalation`: the escalation is resolved **on disk by the Gatekeeper**
  (decision text byte-verbatim, `resolvedAt` stamped), then re-derived through F9 detail and the
  live F5 watcher until the F6 queue entry disappears (TEST-692..694).
- `resolveEscalation` with feedback **enabled** emits a decision **event to the outbox** and
  deliberately does **not** touch `state.json` — resolution belongs to the control plane
  downstream (TEST-697 pins that contract honestly).
- `submitWork` (F12 quick-capture) lands an `IN-*` item in the file-mode **inbox** via the real
  `feedback submit`, and the real `feedback apply` drains it to `backlog.jsonl` (journaled,
  idempotent) — TEST-698.
- Feedback-**disabled** writes are the distinct `feedback-disabled` non-dispatch outcome with the
  CLI's refusal verbatim and **zero filesystem trace**; no auto-enable anywhere (TEST-699).
- The F5↔F7 trust boundary: a pane-only aggregate member is readable/queueable but write-refused
  (`root-not-allowed`) because the allowlist is `registry.roots()` (persisted only) — TEST-700.

## Environment gating

- `orky-act-loop` and `orky-osc-loop` require the real Orky plugin
  (`ORKY_PLUGIN_DIR`, defaulting to `C:/dev/Orky/plugin`). When absent they **skip** (never fail),
  so `npm test` stays deterministic on machines without Orky; the committed golden fixtures
  (`tests/fixtures/orky-contract/` + `tests/shared/orky-contract-golden.test.ts`) keep the contract
  pinned there. TEST-691 additionally runs the live `gatekeeper contract` handshake when the
  plugin is present.
- **Live PTY delivery** (a real ConPTY feeding `OrkyOscParser` inside `PtyManager`) remains
  env-blocked in the node-env vitest harness; the OSC suite therefore pins the contract using the
  real emitter's bytes captured via the same `runOrkyCli` seam, split byte-by-byte through the
  production parser. Renderer-composited surfaces (queue panel, OrkyPane, capture modal, notifier
  toasts) are covered by the existing per-feature Playwright specs under `tests/e2e/` (including
  the `*-loopback` specs that drive renderer→main→CLI-stub loops against `out/`).
