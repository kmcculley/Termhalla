# Tests — 0018-windowed-flow-control

**Phase:** 4 (tests). Suites written BEFORE implementation; verified RED (the flow-control module
and backend surface do not exist yet). Frozen at the tests gate (ADR-009).

## Files

- `tests/remote-flow-control.test.ts` — NEW: the pure shared module.
- `tests/agent-backend-flow.test.ts` — NEW: fake-backend pause/resume/flood + real-backend structural pin.
- `tests/agent-session-flow.test.ts` — NEW: in-process session semantics, stall, recovery.
- `tests/agent-stdio-flow.test.ts` — NEW: stdio child integration (on-demand bundle, `--pty=fake`).
- `tests/docs-feature-0018.test.ts` — NEW: REQ-015 documentation pins.
- `tests/agent-session.test.ts` — EDIT (supersession per its own CONV-019 retirement path): the
  TEST-773 `'ack/window are inert'` vector retired; siblings byte-unchanged; header records the
  supersession and where the semantics are now pinned.
- `tests/remote-protocol-capabilities.test.ts` — EDIT (supersession per CONV-019/CONV-022): the
  TEST-747 exact export list extended by the five flow-control exports; header records it.

## TEST → REQ map

| TEST | REQ(s) | Asserts |
|---|---|---|
| TEST-779 | REQ-002 | `flowPayloadSize` = UTF-16 code units (`''`→0, `'abc'`→3, non-BMP pair→2, 8 KiB fill); gate and policy derive identical accounting from the same raw strings |
| TEST-780 | REQ-003 | `DEFAULT_FLOW_WINDOW_BYTES === 1_048_576`, `DEFAULT_ACK_EVERY_BYTES === 65_536`; default window visible via `stats`; override matrix (0, −1, 1.5, NaN) throws naming parameter + value |
| TEST-781 | REQ-001, REQ-004 | `flow-control.ts` exists and is timer/clock/RNG-free; per-pane independent accounting; `stats(untracked)` undefined |
| TEST-782 | REQ-005 | pause exactly once on FIRST `unacked > window` crossing; never again while paused; strict `>` (at-window does not pause) |
| TEST-783 | REQ-006 | ack decrements silently; over-ack clamps to 0 + exactly one diagnostic naming pane/acked/outstanding; unknown-pane ack fully silent no-op |
| TEST-784 | REQ-007 | per-pane shrink→pause + recorded window; connection default hits non-explicit + future panes only; growth→resume at new low watermark; untracked window→1 diagnostic, nothing stored; `size=1` boundary (drain to 0) |
| TEST-785 | REQ-008 | resume exactly at `unacked ≤ floor(window/2)`; 10-cycle scripted interleaving alternates strictly pause/resume |
| TEST-786 | REQ-009 | `paneExited` clears unacked/paused/explicit window (id reuse starts fresh under default); `dispose` clears all; policy `paneClosed`/`dispose` prune |
| TEST-787 | REQ-012 | null below threshold; full-accumulation ack (reset to 0); residue `flush()` sorted by pane id then `[]`; empty data creates no state; every frame passes `parseWireMessage` |
| TEST-788 | REQ-010 | fake: no delivery while paused; ordered flush on resume; idempotent double pause/resume (no duplication); exit while paused defers behind queued data (exit-last) |
| TEST-789 | REQ-011 | `flood N B`: exactly N emissions of exactly B units between C marker and `D;0`; byte-deterministic across runs; malformed/oversized args → actionable line + `D;1`, handle survives; unknown-command contract intact |
| TEST-790 | REQ-010 | structural: `AgentPtyHandle` declares `pause()/resume()`; `NodePtyProc` mirror widened; handle maps directly onto `proc.pause()/proc.resume()` (CONV-032-anchored regexes) |
| TEST-791 | REQ-005, REQ-013 | session: flood past window(100) → `pause()` called exactly once; emitted units in `(window, window+chunk]`; flood incomplete; session alive |
| TEST-792 | REQ-006, REQ-007, REQ-013 | session: ack/window get NO res and no happy-path diagnostic; unknown-pane window→1 stderr diag; unknown-pane ack silent; late ack after exit silent + session serviceable; window pre-hello still fails handshake (F15 taxonomy unchanged) |
| TEST-793 | REQ-009, REQ-013 | session: kill prunes explicit per-pane window; late ack for dead incarnation silent; reused id is a fresh spawn flooding un-paused under the default window to completion |
| TEST-794 | REQ-008, REQ-013 | session stall+recovery: zero acks → bounded (≤ window+chunk) and STALLED across a live pane-b round-trip; client-policy-driven acks drain to completion; final stream byte-equals a never-paused golden run; pause/resume strictly alternate; `endOfInput` → exit 0 |
| TEST-795 | REQ-013 | stdio child (on-demand bundle, `--pty=fake`): window 4096 declared on the wire; 16 KiB flood stalls bounded ≤ window+chunk across TWO barriers on a second pane; policy-driven acks (+ residue flush) complete the flood; exactly chunks×bytes units between C and `D;0`; stdin end → exit 0 |
| TEST-796 | REQ-015 | docs: remote-agent.md names both defaults + hysteresis + flood and drops the "inert by design" claim; remote-protocol.md drops "attached to NO semantics" and points at `flow-control.ts`; CHANGELOG records 0018 flow control |
| TEST-747 (superseded) | REQ-014, REQ-001 | the barrel's exact sorted export list now includes the five flow-control exports — scope stays mechanically pinned |
| TEST-773 (superseded) | REQ-014 | the inertness vector is retired per its own retirement path; sibling lifecycle assertions byte-unchanged |

## RED verification

`npm test` (vitest, `tests/**/*.test.ts`) exits non-zero: every new suite fails at import time
(`@shared/remote/protocol` does not export the flow-control API yet) or on missing behavior
(`flood`/`pause` absent); the superseded TEST-747 list fails until the barrel exports land. The
pre-existing suites (including the edited TEST-773 siblings) remain green — the red set is
exactly this feature's.

## Determinism notes

Everything in-process is synchronous (the fake backend emits synchronously; gate/policy are pure).
The stdio suite waits only on same-channel barriers (completed round-trips on a second pane) and
frame arrival — no bare sleeps as assertions (the 10 ms poll inside `waitFor` mirrors the frozen
0017 harness). The `flood` filler is spec-required to be a fixed repeating pattern; TEST-789 pins
run-to-run byte determinism, and TEST-794 compares against a golden-by-construction run rather
than hardcoding filler bytes.
