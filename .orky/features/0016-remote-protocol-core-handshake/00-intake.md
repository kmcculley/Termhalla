# Intake — 0016-remote-protocol-core-handshake

**Captured:** 2026-07-04
**Source:** Remote Agent v1 roadmap entry F15 (`.orky/roadmap.json` / `.orky/roadmap.md`), scaffolded
by orky-app-batch (app-run mode — the concept was fixed at roadmap time; brainstorm recorded from the
roadmap entry).

## Roadmap entry (verbatim)

- **id:** F15
- **slug:** 0016-remote-protocol-core-handshake
- **title:** Remote wire protocol core + version/capability handshake
- **controls:** [] (none assigned)
- **deps:** [] (batch 1 — nothing upstream)

### Summary (verbatim)

> Pure protocol layer in src/shared/ (zero Node/Electron imports, vitest-only, zero behavior change
> to the running app) derived from the typed ipc-contract.ts: framing over a byte stream,
> request/response correlation, agent→client push events, and the connect handshake — an
> EXACT-version check (locked: client and agent are version-locked because the client provisions the
> agent; the handshake is a version check, NOT a compatibility matrix) plus capability advertisement
> where the capability partition IS the set of per-domain IPC registrar names (v1 agent advertises
> only pty + status). Includes the flow-control ack/window frame types (semantics land in F17).
> Stdio is the only assumed transport, so the identical protocol path runs over system ssh in
> production and over a plain local child process in CI/e2e. Stack: TypeScript/Node (Electron app;
> this feature is pure shared logic), tests via vitest in tests/, path alias @shared/..., TDD per
> repo CLAUDE.md.

## Role in the app

Batch 1 of the Remote Agent v1 epic — the foundation every other feature builds on. F16 (agent
runtime skeleton) speaks this protocol over stdio; F17 gives the ack/window frame types their
semantics; F19 runs the same handshake over system ssh. Rationale from the roadmap: "Pure shared
protocol; zero behavior change to the running app."

## Locked design decisions carried in (human-confirmed 2026-07-04; not to be re-opened)

1. Transport = stdio exec channel over SYSTEM ssh; CI/e2e spawns the agent as a plain local child
   process over the IDENTICAL protocol path — the protocol assumes nothing beyond a byte stream.
2. Client-provisioned agent: EXACT version check on connect (version-locked; NOT a compatibility
   matrix).
4. Windowed flow control from day one — F15 defines the ack/window FRAME TYPES; semantics land in F17.
6. Capability handshake: the agent advertises which IPC domains it implements; the per-domain IPC
   registrar names ARE the capability partition. v1 agent = pty + status only.
11. Hard invariants: protocol code is pure `src/shared/`; renderer keeps zero Node/Electron imports;
    characterization tests stay green; local-only behavior unchanged when no remote workspace exists.

## Explicit non-goals (from the roadmap)

- No transport implementation (no ssh spawning, no child-process management) — F16/F19 territory.
- No flow-control SEMANTICS (pause/resume behavior) — frame types only; F17 owns the semantics.
- No renderer/main wiring, no UI, no behavior change to the running app.
- No compatibility matrix in the handshake (locked decision 2).
