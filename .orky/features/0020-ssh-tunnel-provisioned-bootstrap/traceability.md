# Traceability — 0020-ssh-tunnel-provisioned-bootstrap

Human-readable rendering of `traceability.json` (REQ → TASK → TEST → files), reconciled at
doc-sync against the shipped implementation.

| REQ | Requirement (short) | Tasks | Tests | Files |
|-----|---------------------|-------|-------|-------|
| REQ-001 | New `src/remote-client/` tree, invisible to the app; typecheck folding | TASK-007 | TEST-2001 | tsconfig.node.json, src/remote-client/ |
| REQ-002 | Zero behavior change; frozen surfaces intact; pure shared model | TASK-009, TASK-001 | TEST-2002 | src/shared/remote-agents.ts |
| REQ-003 | Named-agent pure model, seeded from favorites, no secrets | TASK-001 | TEST-2002, TEST-2010, TEST-2011 | src/shared/remote-agents.ts |
| REQ-004 | Registry store: path-injected, normalized, atomic | TASK-003 | TEST-2019 | src/remote-client/agents-store.ts |
| REQ-005 | Exec-channel argv builder (favorites seeding rules) | TASK-002 | TEST-2012 | src/remote-client/ssh-command.ts |
| REQ-006 | Argv-injection guards on seeded fields | TASK-002 | TEST-2013 | src/remote-client/ssh-command.ts |
| REQ-007 | System ssh binary, injectable, never a library | TASK-004 | TEST-2003 | src/remote-client/ssh-spawn.ts |
| REQ-008 | Versioned remote install path | TASK-002 | TEST-2014 | src/remote-client/ssh-command.ts |
| REQ-009 | Launch command: probe-then-exec, absent sentinel 127 | TASK-002 | TEST-2015 | src/remote-client/ssh-command.ts |
| REQ-010 | Connect: F15 handshake over child stdio, reused | TASK-006 | TEST-2005, TEST-2020 | src/remote-client/bootstrap.ts |
| REQ-011 | Failure classification: provisionable vs fatal | TASK-005, TASK-006 | TEST-2018, TEST-2021, TEST-2022, TEST-2023 | src/remote-client/classify.ts, bootstrap.ts |
| REQ-012 | Upload: streamed, size-verified, atomic promote | TASK-002, TASK-006 | TEST-2016, TEST-2024, TEST-2025 | ssh-command.ts, bootstrap.ts |
| REQ-013 | Nonce: injectable, collision-safe default, validated | TASK-002, TASK-006 | TEST-2017 | ssh-command.ts, bootstrap.ts |
| REQ-014 | Orchestration: classify → provision → retry ONCE | TASK-006 | TEST-2026, TEST-2027, TEST-2028, TEST-2029 | src/remote-client/bootstrap.ts |
| REQ-015 | Version-lock: one canonical version, artifact injected | TASK-006 | TEST-2004, TEST-2032 | src/remote-client/bootstrap.ts |
| REQ-016 | Abort: kill children, indeterminate provision outcome | TASK-006 | TEST-2030, TEST-2031 | bootstrap.ts, ssh-spawn.ts |
| REQ-017 | Gold round-trip: real bundle through the shim | TASK-008 | TEST-2033 | tests/fixtures/fake-ssh.mjs |
| REQ-018 | Fake ssh shim: local, deterministic, network-free | TASK-008 | TEST-2006, TEST-2026, TEST-2033 | tests/fixtures/fake-ssh.mjs |
