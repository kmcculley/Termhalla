# Termhalla — Environment Variable Manager — Design Spec

**Date:** 2026-06-15
**Status:** Approved (autonomous batch; recommended options chosen)
**Builds on:** the pty layer (`PtyManager.spawn` env) + persistence.

## 1. Summary

Manage environment variables injected into terminals — **global** (all terminals) and
**per-terminal** — with values **encrypted at rest** and unlocked with a passphrase. The
secret backend is pluggable; this version ships the **encrypted-local** store. (External
vaults — Bitwarden / Azure Key Vault / AWS Secrets Manager — are architected behind a
`SecretSource` seam but **deferred**: they need external CLIs + live auth that can't be
verified in this environment.)

## 2. Decisions (recommended)

| Decision | Choice |
|---|---|
| Scope | **Global** vars (every terminal) + **per-terminal** vars (a terminal's own group). |
| Storage | **Encrypted-local** `env-vault.json` in userData: AES-256-GCM, key derived from a passphrase via `scrypt`. Plaintext + key live only in **main-process memory** after unlock. |
| Linking per-terminal | `TerminalConfig.envId?: string` → a group in the vault (the workspace JSON stores only the id, never values). |
| Unlock | A passphrase modal on demand (opening the manager, or first spawn needing vars while locked). First use sets the passphrase (creates the vault). |
| Injection | On spawn, `env = process.env + vault.global + vault.terminal[envId]` (per-terminal overrides global). Locked vault ⇒ no injection (the UI prompts to unlock). |
| Secrecy | Renderer never persists secrets; it receives values only to display/edit in the manager. The passphrase is sent once over IPC to unlock, never persisted or logged. |
| Vaults | A `SecretSource` interface is defined; concrete Bitwarden/Azure/AWS resolvers are **deferred** (documented extension point). |

## 3. Crypto core (testable) — `src/main/env-vault/crypto.ts`

- `encryptJSON(data: unknown, passphrase: string): EncryptedBlob` — `scrypt(passphrase, randomSalt, 32)`
  → key; `aes-256-gcm` over `JSON.stringify(data)` with a random 12-byte iv; returns
  `{ v: 1, salt, iv, tag, ct }` (all base64).
- `decryptJSON(blob: EncryptedBlob, passphrase: string): unknown` — re-derives the key from
  `blob.salt`, decrypts; **throws** on a wrong passphrase or tampering (GCM auth failure).
- Pure over `node:crypto`; unit-tested (round-trip; wrong passphrase throws; tampered ct throws).

## 4. Main — `src/main/env-vault/env-vault.ts`

`EnvVault` (holds decrypted data + the passphrase in memory only while unlocked):
- `exists(): boolean` — is `env-vault.json` present?
- `unlock(passphrase): boolean` — read the blob, `decryptJSON`; on success hold the data + passphrase,
  return true; on failure return false (no state change).
- `create(passphrase): void` — initialize `{ global: {}, terminals: {} }`, encrypt, write, mark unlocked.
- `isUnlocked(): boolean`; `lock(): void` (clear memory).
- `data(): VaultData | null` (decrypted, when unlocked).
- `setGlobal(name, value)` / `removeGlobal(name)` / `setTerminal(envId, name, value)` /
  `removeTerminal(envId, name)` — mutate + re-encrypt + write (only when unlocked).
- `envFor(envId?: string): Record<string, string>` — `{ ...global, ...(envId ? terminals[envId] : {}) }`
  (empty when locked).

`VaultData = { global: Record<string,string>; terminals: Record<string, Record<string,string>> }`.

## 5. Injection

- `PtyManager.spawn` gains an `extraEnv?: Record<string,string>` arg, merged into the spawn env
  (`sanitizeShellEnv({ ...process.env, ...spec.env, ...extraEnv })`).
- `PtySpawnArgs` gains `envId?: string`; `register.ts`'s `ptySpawn` handler computes
  `envVault.envFor(a.envId)` and passes it. The renderer includes `config.envId` in the spawn args.

## 6. IPC

- `env:state` (main→renderer event: `{ exists: boolean; unlocked: boolean }`).
- `env:unlock (passphrase) → boolean`; `env:create (passphrase) → void`; `env:lock () → void`.
- `env:get () → VaultData | null` (names+values, only when unlocked — used by the manager UI).
- `env:setGlobal (name, value)`, `env:removeGlobal (name)`, `env:setTerminal (envId, name, value)`,
  `env:removeTerminal (envId, name)`.
- Preload methods mirror these; `onEnvState(cb)`.

## 7. Renderer

- Store: `env: { exists: boolean; unlocked: boolean }` (from `env:state`); actions wrapping the IPC.
- **`EnvManager.tsx`** (portal modal), opened from a tab-bar button (`🔑`) and from a terminal's gear:
  - **Locked + exists** → passphrase field + Unlock. **No vault** → "Set a passphrase" + Create.
  - **Unlocked** → a Global section (name/value rows, add/remove) and, when opened for a terminal, a
    Per-terminal section (creates a `config.envId` for the terminal on first var). A Lock button.
  - Values render as password inputs with a reveal toggle.
- A terminal with env vars shows a small `🔑` indicator; a `config.envId` is assigned via `updatePaneConfig`
  when the user adds the first per-terminal var.
- New terminals pass `envId` in the spawn args (via `TerminalPane`).

## 8. Error handling / security

- Wrong passphrase → `unlock` returns false; the UI shows "Incorrect passphrase". GCM tamper → treated as wrong.
- The passphrase and decrypted values are **never** written to disk, logged, or put in the workspace JSON.
- A locked vault injects nothing (terminals spawn without the vars) — non-fatal; the manager prompts to unlock.
- All vault file ops are guarded so a missing/corrupt file never crashes main.

## 9. Testing

- **Unit (vitest):** `encryptJSON`/`decryptJSON` round-trip; wrong passphrase throws; tampered ciphertext
  throws. `EnvVault` (temp dir): create→unlock→setGlobal→envFor; wrong-passphrase unlock fails; `envFor`
  merges global + terminal (terminal overrides).
- **e2e (Playwright):** open the env manager, set a passphrase, add a global var `FOO=bar7788`, then spawn a
  new terminal and run `echo $env:FOO` (PowerShell) → the terminal shows `bar7788`. (Vault unlocked in-session.)

## 10. Non-goals

- **Deferred:** Bitwarden / Azure Key Vault / AWS Secrets Manager resolvers (the `SecretSource` seam exists;
  concrete backends need their CLIs + auth and are out of scope for this version).
- No auto-unlock / OS keychain integration (passphrase per session).
- No env var editing of `process.env` itself; only additive injection.
- No secrets sent to the renderer except for display in the manager while unlocked.
