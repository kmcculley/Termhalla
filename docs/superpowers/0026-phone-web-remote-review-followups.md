# 0026-phone-web-remote — review follow-ups

Per-feature deferred work for `features/0026-phone-web-remote`. This feature went through ten
human escalations (ESC-001..ESC-010) and six review rounds; every CRITICAL/HIGH/contract-violation
finding was fixed and closed on evidence (see `findings.json` — 67 resolved). The 54 findings below
are the non-blocking remainder (all LOW or MEDIUM, none CRITICAL/HIGH, none `contract_violation`),
routed here per repo convention instead of being silently lost once the feature's working files
stop being actively read. IDs are stable — see `features/0026-phone-web-remote/findings.json` for
full claim/fix text and exact line locations.

**Done when:** a future feature (or a dedicated fix pass) picks an item, fixes it, and either
removes it from this list or marks it done with a commit reference.

## Recurring pattern: unpinned loopback fixes (highest priority to internalize)

Four consecutive human-mandated fix rounds (ESC-003, ESC-004/005, ESC-006, ESC-007/008) shipped
with the frozen test suite held unchanged — i.e. real production fixes for HIGH findings landed
with zero regression test coverage of the fixed path. This is now `CONV-075` (see
`.orky/conventions.md`); the specific unpinned vectors are tracked here so a future pass can add
the regression tests directly rather than re-discovering them:

- **FINDING-077 / FINDING-079** (ESC-003 round — cookie-issuance-after-restart,
  burst-queue/attach-barrier ordering under `src/main/phone-remote/service.ts`'s pre-transport
  burst queue) — no test traverses `queueData`/`flushNow`/`markStale`.
- **FINDING-087 / FINDING-092** (ESC-004/005 round — `externalOrigin()` full-origin branch,
  `WsSession.paneExit`'s `owesFinal` final-output-at-exit branch) — untested.
- **FINDING-104 / FINDING-105** (ESC-006 round — transactional regenerate/settings persist-first,
  ordered mirror resize in `replay-engine.ts`, exited-pane resize guard) — untested.
- **FINDING-118** (ESC-007/008 round — the `quick.json` two-writer-clobber fix, the `quickLoad`
  overlay in `register-workspaces.ts`) — untested.

A single tests-phase amendment adding real-transport/real-composition vectors for all of the above
would close 077/079/087/092/104/105/118 in one pass — they name the same handful of code paths
repeatedly.

## Security / hardening (open)

- **FINDING-061** (MEDIUM) — No `Origin` header validation on the WS upgrade or cookie-authenticated
  HTTP routes; a same-LAN malicious page could ride the HttpOnly cookie (CSWSH-class). Fix: reject
  upgrade/request when `Origin` doesn't match the server's own bind host:port / configured
  `externalHost`.
- **FINDING-090** (LOW) — No hardening response headers (`X-Content-Type-Options: nosniff`,
  `Content-Security-Policy`, `X-Frame-Options`) on served content.
- **FINDING-103** (MEDIUM) — `REQ-014` ("no filesystem/editor access") is enforced only by an
  untested cross-module invariant (only terminal panes ever populate `phoneRemoteLivePanes`), not
  an explicit kind check at the authorization boundary. Cross-checked as currently-speculative by
  FINDING-112 (LOW) — no live path can violate it today, but no structural guard prevents a future
  one.

## Networking / determinism (open)

- **FINDING-062 / FINDING-065 / FINDING-073** (MEDIUM, spec-origin) — An unsubscribed pane's grid
  can go stale with no refresh path: a desktop resize of a pane the phone isn't currently viewing
  produces no `grid` push and no inventory re-push, so a later tap can render mis-wrapped until a
  reconnect. Fix direction: emit `grid` as the first step of `finishAttach`, ahead of the snapshot,
  from the pane's live cols/rows rather than relying only on the last push.
- **FINDING-080** (LOW) — `grid`/`status` pushes bypass the per-connection burst queue and can
  overtake parked pane `data` from the same tick.
- **FINDING-081** (LOW) — The stall-episode wall clock (`pendingSince`) isn't reset per
  pending→non-pending transition; a spurious 50ms-boundary race could affect the ceiling-termination
  decision.
- **FINDING-094** (LOW) — `mirror-manager.registerPane` replaces an existing record for the same
  pane id without disposing the previous mirror during the exit-settle race window (rare leak).
- **FINDING-099** (LOW) — Inventory workspace-group ordering and pane fallback-title assignment
  ride incidental map/insertion order rather than a stated deterministic rule.
- **FINDING-116** (MEDIUM) — Residual `quick.json` two-writer race survives the FINDING-095 fix:
  writes are now field-coherent but still unserialized (last-rename-wins). Now `CONV-076`; fix
  direction: one owner-serialized write queue for `quick.json`, used by both the `quick:save` IPC
  handler and the phone-remote service's `saveSettings`.
- **FINDING-117** (MEDIUM) — Second clause of the ESC-007 decision ("no `tokenHash` sent to the
  renderer") was never implemented; `CH.quickLoad` still returns the full `phoneRemote` object
  (including `tokenHash`) to every renderer.

## Performance (open, all LOW except one MEDIUM)

- **FINDING-004** — `isLive(paneId)` materializes the full live-pane list on every keystroke/input
  message instead of an O(1) map lookup.
- **FINDING-005** — While disabled, `phoneRemoteSend` still does small per-chunk bookkeeping
  (channel compare, map lookup/set) beyond a pure constant-time enabled check; REQ-001's stated
  intent ("no per-chunk work beyond a constant-time check... no standing per-chunk live-pane
  bookkeeping while disabled") is met in substance (no mirror feed) but not to the letter.
- **FINDING-007** — Phone client's `PaneList.setStatus` rebuilds the entire list DOM on every
  status/paneExit push, including no-op status-unchanged pushes and while the list is hidden.
- **FINDING-056** — The v2 pre-transport burst queue does per-chunk accounting work even for panes
  a session isn't tracking.
- **FINDING-057** — Inventory re-push builds the payload once per SESSION instead of once per push
  fanned to all sessions, with no change-detection to skip unchanged re-pushes.
- **FINDING-114** — `phoneRemoteWorkspaceNames` grows monotonically; no `onWorkspaceDeleted` hook
  ever prunes it.

## Quality / structure (open)

- **FINDING-052** (MEDIUM) — `service.ts`'s ~170-line WS connection handler mixes four concerns
  (keepalive, RST fallback, burst-queue backpressure, subscription wiring) inline; candidate for
  extraction into a `connection-guard.ts` factory.
- **FINDING-053** (MEDIUM) — `register.ts` (the app-wide IPC composition root) absorbed ~150 lines
  of phone-remote-specific pane/workspace bridging state; candidate for extraction into
  `src/main/phone-remote/pane-bridge.ts`.
- **FINDING-054** (LOW) — Three-plus near-duplicate pane-record type shapes across the module with
  no shared canonical type.
- **FINDING-055** (LOW) — `PhoneRemoteSettings.tsx`'s doc comment claims its component-local-slice
  architecture is "documented" elsewhere; it isn't yet.
- **FINDING-075** (MEDIUM) — Four exported members (`reconnectAttachPlan`, `TerminalView.setPane`,
  `PhoneRemoteServer.isRunning`, `staticFilePath`) have zero production call sites.
- **FINDING-076** (MEDIUM, tests-origin) — No test asserts `status().enabled` survives a failed
  start (only `running`/`error` are pinned) — the exact invariant that regressed once already.
- **FINDING-098** (MEDIUM, tests-origin) — REQ-023's unsubscribe-before-subscribe pane-switch
  hygiene has zero wiring-level test coverage (only the pure plan function is tested).

## UX (open, mostly LOW)

- **FINDING-064** (MEDIUM) — One failed enable click can raise up to four duplicate, non-auto-
  dismissing error toasts (uncoordinated toast-owner paths).
- **FINDING-066** (LOW) — The phone client's error banner is sticky across pane switches; only
  cleared on WS reconnect.
- **FINDING-067** (LOW) — Ctrl-latch armed state is conveyed by background color alone; no
  `aria-pressed`, no non-color cue.
- **FINDING-068 / FINDING-107** (LOW; 107 narrows 068) — The external-host settings field accepts
  malformed pastes silently; validation should accept either a bare hostname or a syntactically
  valid `http(s)` origin (not reject schemes, per the settled ESC-004 decision).
- **FINDING-069 / FINDING-074** — Doc phrasing referencing the pre-cookie "stored token" model and
  a nonexistent `ws` `'drain'` event — **fixed in this doc-sync pass** (`docs/features/phone-web-remote.md`).
- **FINDING-072 / FINDING-106** (106 narrows 072) — Unverified iOS Safari cookie-container-sharing
  premise for the home-screen PWA relaunch story; per FINDING-106's cross-check, current WebKit
  (17.2+) unifies the storage container, so this is stale against the declared target — recommend
  closing 072 as unreproduced rather than fixing, unless a pre-17.2 support floor is intended.
- **FINDING-088** (LOW) — `#error-banner`/`#connection-status` carry no `role`/`aria-live`.
- **FINDING-089** (LOW) — The pane-exit overlay is a full-cover, non-dismissible dark layer.
- **FINDING-100** (LOW) — Regenerate pairing token is a one-click destructive action with no
  confirm step.
- **FINDING-101 / FINDING-111** (LOW; 111 narrows 101) — Pairing-URL copy button swallows clipboard
  failures silently and bypasses `api.clipboardWrite`.
- **FINDING-102** (LOW) — The full-screen terminal view shows no pane identity (title/workspace)
  in its own chrome. Now `CONV-079`.
- **FINDING-115** (LOW) — Settings copy renders literal backtick characters instead of `<code>`.

## Codex cross-check notes (informational, LOW)

- **FINDING-096** — Shipped PWA icons are 1×1 placeholder pixels, not the 192×192/512×512 the
  manifest declares.
- **FINDING-097** — Phone client's `pane-list.ts` status map leaks one entry per pane id for the
  page's lifetime (never pruned on inventory membership change).
- **FINDING-106 / FINDING-107 / FINDING-111 / FINDING-112** — narrow/qualify FINDING-072/068/101/103
  respectively (see above); listed once, not duplicated as separate action items.

## Conventions promoted from this feature's findings

See `.orky/conventions.md` CONV-073..CONV-079, promoted from FINDING-015/030 (third-party emitter
event verification), FINDING-024 (mount-path test for new user-facing surfaces), FINDING-077/092/
104/105/118 (unpinned loopback fixes), FINDING-116 (single serialized write queue per persisted
file), FINDING-025 (auth credential presentable on every entry path), FINDING-071 (status field
needs a pinned renderer), and FINDING-102 (full-screen detail view identity).
