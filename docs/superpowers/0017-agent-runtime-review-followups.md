# 0017-agent-runtime-skeleton — review follow-ups

Deferred work surfaced by the 0017 review (5-lens fan-out + codex read-only cross-check). The
feature shipped with **one resolved finding** (FINDING-001, post-exit `pty:data` liveness guard —
fixed in-review, verified by the full suite and a re-derived implement gate) and **one open LOW**
deferral recorded below. Ledger of record: `.orky/features/0017-agent-runtime-skeleton/findings.json`.

## Open (deferred by design)

1. **FINDING-002 (LOW, devils-advocate) — real-backend SIGHUP teardown residual.** REQ-013's
   "a live pane must not keep the process alive on stdin end" is proven through the fake backend;
   the real `node-pty` backend's `kill()` sends the default signal, and a child that ignores
   SIGHUP keeps its pty fds open and can hold the remote agent process after the ssh channel
   drops. Not CI-exercisable in v1 (the real backend is Linux-only; no real node-pty loads in
   CI). **Owner: F18/F19 hardening** (session survival + provisioning own agent-process
   lifetime): add a bounded SIGKILL escalation after `kill()` in
   `src/agent/node-pty-backend.ts`, verified on a real Linux host.

## Disclosed, no action planned in this epic

- **OSC 7 cwd heuristics (CONV-054 disclosure, spec "Baseline note").** The reused `CwdParser`
  applies Windows-oriented conversions to OSC 7 `file://` URLs; a POSIX path with a
  single-letter first segment (e.g. `/u/data`) misreads as a drive path. The agent's status REQs
  and vectors use the heuristic-free OSC `9;9` form; real Linux shells that emit OSC 7 with such
  paths inherit the pre-existing parser wart. Revisit with F21's remote-workspace UX if it
  proves user-visible.
- **No agent-side resource caps / backpressure** — deliberate: F17 (windowed flow control) owns
  output-volume bounding; the client owns liveness/timeouts (F19/F21). Inbound `ack`/`window`
  inertness was pinned by TEST-773 and named for retirement by F17's tests phase (CONV-019).
  *(Resolved 2026-07-04: F17 / 0018-windowed-flow-control landed the semantics and superseded
  the TEST-773 inertness vector through its tests phase exactly as prescribed — see
  `docs/features/remote-agent.md` § Flow control.)*
- **Real-backend spawn path untested in CI** — locked decisions 1 + 9 (Linux-only v1; no real
  node-pty/ssh in CI). The integration suite proves the identical protocol path through the real
  artifact with the fake backend; the `node-pty` load/spawn path needs a one-time smoke on a
  real Linux host when F19 lands the provisioning flow.
