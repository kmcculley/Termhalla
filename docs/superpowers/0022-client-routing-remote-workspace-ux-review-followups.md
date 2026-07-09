# 0022-client-routing-remote-workspace-ux — review follow-ups

Deferred, non-blocking findings from the F21 review (full ledger:
`.orky/features/0022-client-routing-remote-workspace-ux/findings.json`). The seven code-addressable
findings (FINDING-001/002/003/004/005 from the lens reviewers + FINDING-007/008 from the codex
cross-check) were fixed in the same run via a review→tests→implement loopback and are resolved —
this doc tracks what stays open.

## Open (LOW, deliberate deferral)

- ~~**FINDING-006 (ux) — multi-window duplicate disconnect toasts.**~~ — **RESOLVED 2026-07-09**
  (quality/polish batch), via the recorded candidate fix with one refinement: the hosting check is
  an OPTIONAL injected dep (`hostsWorkspace?`, wired in store.ts as
  `!!get().workspaces[wsId]`), absent ⇒ toast — so the FROZEN single-window contract
  (tests/renderer/remote-slice.test.ts, whose harness injects no such dep) runs byte-identical,
  answering the very concern that deferred this. Pinned vectors in
  `tests/renderer/remote-slice-host-toast.test.ts` (hosting window toasts, non-hosting ingests
  silently with state intact, absent dep = old behavior, per-workspace-id consultation).

## Deferred remainders of resolved findings

- ~~**FINDING-007 (security, codex) — a dedicated pinned vector for the evt pane-membership
  guard.**~~ **RESOLVED 2026-07-07:** the NEGATIVE vector now exists —
  `tests/main/remote-manager-evt-validation.test.ts` pins that an evt for an unowned pane id is
  dropped on all four channels (no send, one diagnostic each, owned panes untouched), alongside
  the same suite's per-position payload type-checks (the 2026-07-06 audit borderline fix).

## Review notes (no finding filed)

- The codex cross-check ran bounded (read-only, in-time) and surfaced two confirmed defects worth
  filing (FINDING-007 the evt injection guard; FINDING-008 the OrkyWatcher desired-set diff); its
  other four items restated findings the lens reviewers had already filed (the sender gate =
  FINDING-001; the CONV-011 ghosts = FINDING-002; the orphan-on-refused-move = FINDING-003) or the
  register-pty per-sender ownership question, which is already covered by main's `claimPane`
  ownership model + the routed pane-scoped send (a pane's ops only reach its owning window) and the
  now-added `isKnownWindowSender` gate — not re-filed.
- Determinism and networking lenses ran clean against the manager: the connection generation
  (`gen`) scopes every stale callback, re-adoption walks a sorted pane-id list, the ack policy is
  connection-scoped (fresh per reconnect) with a really-scheduled quiet-flush, and no wall-clock /
  RNG rides the routing path (the frozen suites TEST-2226..2253 pin these).
