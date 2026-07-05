# 0022-client-routing-remote-workspace-ux — review follow-ups

Deferred, non-blocking findings from the F21 review (full ledger:
`.orky/features/0022-client-routing-remote-workspace-ux/findings.json`). The seven code-addressable
findings (FINDING-001/002/003/004/005 from the lens reviewers + FINDING-007/008 from the codex
cross-check) were fixed in the same run via a review→tests→implement loopback and are resolved —
this doc tracks what stays open.

## Open (LOW, deliberate deferral)

- **FINDING-006 (ux) — multi-window duplicate disconnect toasts.** `remote:state` is an app-global
  broadcast, so in a multi-window session EVERY window's `remote-slice` ingests the same
  disconnected transition and each toasts it (the CONV-038 class, in-app variant — one moment,
  duplicate uncoordinated surfacings). The banner itself is correctly single-sourced (only the
  window hosting the workspace renders it), so the duplication is toast-only and low-impact.
  **Candidate fix:** gate the failure toast on the ingesting window actually hosting the workspace
  (`get().workspaces[next.workspaceId]` present) so exactly the window showing the banner also
  raises the toast; needs its own pinned vector (the slice harness would inject a `workspaces`
  view). Deferred rather than slipped in silently because the single-window path (the shipped v1
  common case) is already correct and the fix changes the slice's tested contract.

## Deferred remainders of resolved findings

- **FINDING-007 (security, codex) — a dedicated pinned vector for the evt pane-membership guard.**
  The fix (drop any inbound `pty:*` evt whose id is not in `entry.panes`) is implemented and the
  existing TEST-2249 (a tracked pane forwards) stays green, but no vector yet asserts the NEGATIVE
  (an unowned-id evt is dropped). The freeze was already captured this cycle; add
  `TEST-2284 REQ-010 an evt for a pane this connection does not track is dropped (no send, no ack)`
  at the next sanctioned tests touch in this epic.

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
