# Tests — 0020-ssh-tunnel-provisioned-bootstrap (F19)

**TEST-ID allocation:** this feature owns the block **TEST-2001..TEST-2033** (feature number 0020 →
the 2000s block). Deliberately NOT the next sequential ids after the repo's current max
(TEST-778): batch-3 siblings 0018/0019 run in parallel worktrees with no coordination channel, and
sequential allocation would collide at merge. The feature-number-keyed block is collision-free by
construction. Unused slots 2007–2009 stay reserved for this feature.

**Substrate:** `tests/fixtures/fake-ssh.mjs` — the fake system-ssh shim (REQ-018; header documents
its env contract and rigs). Canned-bytes fake agents are GENERATED inside the bootstrap suite with
the real `encodeFrame` (an independent peer implementation over the identical stdio protocol
path). The gold test builds the real bundle through `vite.agent.config.ts` (TEST-774 pattern).

**Files:**
- `tests/remote-client-structure.test.ts` — TEST-2001..TEST-2006 (structural guards)
- `tests/remote-agents.test.ts` — TEST-2010, TEST-2011 (pure model)
- `tests/remote-client-command.test.ts` — TEST-2012..TEST-2017 (pure builders/validators)
- `tests/remote-client-classify.test.ts` — TEST-2018 (classification truth table)
- `tests/remote-client-store.test.ts` — TEST-2019 (registry store)
- `tests/remote-client-bootstrap.test.ts` — TEST-2020..TEST-2032 (shim integration)
- `tests/remote-client-gold.test.ts` — TEST-2033 (real-bundle gold round-trip)

| TEST | REQ(s) | Assertion |
|------|--------|-----------|
| TEST-2001 | REQ-001 | `src/remote-client/` exists; imports no electron/renderer/preload/main; zero app-tree consumers (scope guard, F21 retirement named — CONV-019/CONV-037); tsconfig.node.json includes src/agent AND src/remote-client |
| TEST-2002 | REQ-002, REQ-003 | `src/shared/remote-agents.ts` is environment-pure (TEST-745 forbidden-reference list) |
| TEST-2003 | REQ-007 | no ssh-implementation npm dependency (scoped invariant, NOT an equality pin — CONV-022); no ssh-lib import in remote-client; no `shell: true`; `DEFAULT_SSH_PROGRAM === 'ssh'` |
| TEST-2004 | REQ-015 | remote-client never references `package.json` (version is injected) |
| TEST-2005 | REQ-010 | bootstrap imports decoder/handshake/encode from `@shared/remote/protocol`; no hand-built hello literal anywhere in remote-client |
| TEST-2006 | REQ-018 | shim exists; imports no network module |
| TEST-2010 | REQ-003 | seeding copies exactly host/user/port/identityFile; never tmux fields; exact key set |
| TEST-2011 | REQ-003 | normalize strips unknown/secret fields; drops invalid records; malformed top-level → []; invalid optional fields coerced away (CONV-002) |
| TEST-2012 | REQ-005 | exact exec argv: `[-p][-i] user@host cmd`; port-22/0 omitted; single command element; no `-t`; no BatchMode |
| TEST-2013 | REQ-006 | injection guards reject option-injection/whitespace/@/port-range/control chars, naming the field (CONV-001); unsafe remote paths rejected |
| TEST-2014 | REQ-008 | `~/.termhalla/agent/termhalla-agent-<v>.cjs` (default + custom dir); version charset enforced |
| TEST-2015 | REQ-009 | exact launch command `test -f P && exec node P --pty=B \|\| exit 127`; sentinel 127 |
| TEST-2016 | REQ-012 | exact upload command (mkdir/cat-to-nonce-tmp/wc -c/mv, `\|\| { rm; exit 93; }`); sentinel 93; byte-count validation (CONV-003) |
| TEST-2017 | REQ-013 | nonce charset enforced at the builder; default source crypto-shaped, distinct across calls |
| TEST-2018 | REQ-011 | classification truth table: 127+no-frames→absent; version-mismatch→version-mismatch; 255/other-kinds/unexpected-exit→fatal with kind/code + stderr excerpt in diagnostic |
| TEST-2019 | REQ-004 | store: missing/garbage → []; round-trip normalizes (secret stripped from disk); atomic save (no temp survivor); full replace |
| TEST-2020 | REQ-010 | shim connect: handshake ok; handle version/capabilities/onExit; one req/res crosses the duplex pipe |
| TEST-2021 | REQ-011 | empty home → `absent` |
| TEST-2022 | REQ-011 | wrong-version agent → `version-mismatch` |
| TEST-2023 | REQ-011 | exit-255 rig → `fatal` with stderr excerpt; ZERO uploads (CONV-051-scoped ledger count) |
| TEST-2024 | REQ-012 | upload lands byte-identical; no `.tmp` survivor |
| TEST-2025 | REQ-012 | truncated stream → size-mismatch (93); final path never occupied; tmp removed |
| TEST-2026 | REQ-014, REQ-018 | absent → provision → connected; ledger: 2 launches, 1 upload |
| TEST-2027 | REQ-014 | mismatch → provision overwrites → connected; 1 upload |
| TEST-2028 | REQ-014 | ignore-upload rig → `provision-ineffective`; exactly 2 connects + 1 upload; diagnostic names the persisting mismatch |
| TEST-2029 | REQ-014 | fatal short-circuit: 1 launch, 0 uploads |
| TEST-2030 | REQ-016 | abort mid-upload → `aborted` + `indeterminate: true` (CONV-015); child killed; suite doesn't hang |
| TEST-2031 | REQ-016 | abort before hello → `aborted`, not indeterminate |
| TEST-2032 | REQ-015 | custom `remoteAgentDir`: artifact lands at `remoteAgentInstallPath(dir, version)` for the SAME version the handshake used |
| TEST-2033 | REQ-017, REQ-018 | REAL bundle via vite.agent.config.ts scratch build: absent → upload → handshake ok; version === package.json; capabilities === AGENT_V1_CAPABILITIES; installed bytes identical |

**RED expectation at this phase:** `src/remote-client/` and `src/shared/remote-agents.ts` do not
exist yet — every suite above fails (module-resolution failures and the structural existence
asserts). The shim fixture exists (it is test substrate, not production code). No existing suite
is touched.
