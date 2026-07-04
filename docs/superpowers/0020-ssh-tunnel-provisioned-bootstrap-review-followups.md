# 0020-ssh-tunnel-provisioned-bootstrap — review follow-ups

Deferred work surfaced by the F19 review (feature dir
`.orky/features/0020-ssh-tunnel-provisioned-bootstrap`, findings ledger `findings.json` there).
Resolved-with-deferred-remainder items are noted on their findings; the OPEN items below are
non-blocking (LOW / doc-routed MEDIUM) by the gate rules and deliberately left to their named
owners rather than slipped in silently.

## Open

- **FINDING-005 (MEDIUM, devils-advocate, spec-origin) — cancellation contract.** No built-in
  connect/handshake timeout (deliberate: a timeout would race 2FA/hardware-key prompting). The
  contract "the caller MUST own cancellation via `options.signal`" is now STATED in
  `docs/features/remote-bootstrap.md` (Contract notes), which is what the finding's doc-route fix
  asked for — F21 MUST wire a user-facing cancel (and may add a convenience `timeoutMs` that wraps
  an internal AbortController; additive, non-breaking). Resolve this finding when F21's consumer
  lands that cancel affordance, or earlier via the optional `timeoutMs`.
- **FINDING-007 (LOW, devils-advocate) — no artifact GC.** Version-embedded artifact names
  accumulate one ~52 KB `termhalla-agent-<v>.cjs` per client version per host. Candidate fix (F21
  or the integration phase): after a successful handshake, prune non-active versions — needs its
  own tests-phase work (the upload/launch command pins are frozen).
- **FINDING-008 (LOW, codex-cross-check, tests-origin) — shim argv parse.** The fake-ssh shim
  slices the remote command via `argv.indexOf(destination)`; an identityFile value string-equal to
  the destination would misparse (unreachable by any current frozen test input). Fix (cursor-based
  slice) belongs to a future sanctioned tests-phase touch of the substrate.

## Deferred remainders of resolved findings

- **FINDING-004** — the deeper probe-sentinel split for the exit-127 conflation
  (`command -v node >/dev/null || exit 96` giving node-missing its own classification) requires
  amending the frozen TEST-2015 launch-command pin through a tests phase. The shipped mitigation is
  diagnostic-level (provision-ineffective names the node-missing possibility).
- **FINDING-006** — pre-hello framing corruption from shell-rc stdout noise stays a fail-fast with
  a hint; skip-to-first-frame recovery was REJECTED on purpose (masks corruption). Revisit only if
  the integration phase shows real-world rc noise is common enough to justify a marker-scan design
  with its own spec.

## Review notes (no finding filed)

- **Codex cross-check claim rejected after verification:** "settle ok only after the handshake
  reply write is accepted" — the child can die a microsecond after ANY success signal (unavoidable
  TOCTOU); F15's own handshake defines establishment at reply-send, and the session handle's
  `onExit` is the death-notification contract. Changing the settle point would not close the race.
- Networking and determinism lenses ran clean (timeout/retry/idempotency/partial-failure/
  backpressure/lifecycle; injected nonce, no wall-clock, deterministic rigs) — the frozen suite
  pins those properties (TEST-2024..2032, TEST-2017).
