# Environment Variable Manager

> Inject environment variables into terminals from an encrypted-local vault — global vars for every shell, or per-terminal overrides — with values stored only as an AES-256-GCM blob on disk.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-15-termhalla-env-vars-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-15-termhalla-env-vars.md)

## What it does

A **🔑** button in the tab bar opens the **Environment variables** manager. The vault holds:

- **Global variables** — injected into the environment of every new terminal.
- **Per-terminal variables** — keyed on a pane's `config.envId`, layered on top of the globals for that one terminal (last-wins).

On terminal spawn the main process merges `envVault.envFor(envId)` (global ∪ per-terminal) into the PTY environment, so a global var set **before** spawning a shell is visible there (e.g. `echo $env:FOO` in PowerShell). Variables added to an already-running terminal apply to terminals spawned afterward, not retroactively.

## Per-terminal variables

Each terminal pane has its own **🔑** button (`env-chip-<paneId>`) that opens the manager **scoped to that terminal** — alongside the read-only globals it shows a **This terminal** section where you can add and delete vars that apply to just that pane (layered over the globals, last-wins).

- The pane's `config.envId` is assigned **lazily** (a fresh uuid) the first time you add a per-terminal var, and the var is written under that id via `api.envSetTerminal(envId, name, value)`. The id is persisted in the workspace JSON so the pane's vars survive a relaunch (`api.envGet()` returns `{ global, terminals }`, re-read on each open).
- **Spawn-timing semantic:** like globals, a per-terminal var applies the **next time that terminal is spawned** (e.g. after reopening the workspace) while the vault is unlocked — it is **not** injected retroactively into the already-running shell.

## Encrypted-local model

Values are never stored in plaintext. The vault is a single AES-256-GCM blob at `…/userData/env-vault.json`:

- The encryption key is **scrypt-derived** from the user's passphrase (random 16-byte salt per write, 32-byte key).
- Each write uses a fresh random 12-byte IV; the GCM auth tag is stored alongside, so a wrong passphrase or any tampering fails the decrypt (`decryptJSON` throws) rather than returning garbage.
- The on-disk blob shape is `{ v: 1, salt, iv, tag, ct }` (all base64). See `src/main/env-vault/crypto.ts`.

## Security model

- **Decrypted values + the passphrase live in main-process memory only while unlocked.** Locking (or app close) clears them; only the encrypted blob remains on disk.
- **Workspace JSON stores only `envId`** (a link to a per-terminal entry) — never names or values. (`TerminalConfig.envId` in `src/shared/types.ts`.)
- **The renderer receives decrypted values only for display** while the vault is unlocked (`api.envGet()` returns the current `EnvVaultData`); nothing is persisted renderer-side.
- Consistent with the repo's "no secrets persisted in plaintext" rule — the vault is the one place secrets live, and only as ciphertext.

## Create / unlock / lock flow

| State | Modal shows |
|---|---|
| No vault on disk (`!exists`) | passphrase input + **Create** → creates an empty vault, unlocked in-session |
| Vault exists, locked (`exists && !unlocked`) | passphrase input + **Unlock** (wrong passphrase shows an inline error) |
| Unlocked | global-var rows (with a 👁 reveal toggle), an add row, and **Lock** / **Close** |

The `{ exists, unlocked }` state is pushed to the renderer via the `onEnvState` event; the store tracks it so the modal renders the right panel.

## Key files

| File | Responsibility |
|---|---|
| `src/main/env-vault/crypto.ts` | pure AES-256-GCM + scrypt encrypt/decrypt (unit-testable) |
| `src/main/env-vault/env-vault.ts` | `EnvVault` — create/unlock/lock, get/set global & per-terminal, `envFor(envId)` |
| `src/main/ipc/register.ts` | `env:*` IPC handlers + the `env:state` push event; passes `envVault.envFor(envId)` into `pty.spawn` |
| `src/main/pty/pty-manager.ts` | merges the vault env over `process.env` at spawn (`{ ...process.env, ...extraEnv }`) |
| `src/main/pty/env.ts` | `sanitizeShellEnv` strips Electron-injected vars from the merged spawn env |
| `src/shared/ipc-contract.ts` | `env*` methods on `TermhallaApi`; `PtySpawnArgs.envId` |
| `src/renderer/components/EnvManager.tsx` | the 🔑 manager modal |
| `src/renderer/components/WorkspaceTabs.tsx` | the 🔑 tab-bar button |
| `src/renderer/store.ts` | `envVault` `{ exists, unlocked }` state |

## Testing

- **Unit:** `tests/main/env-crypto.test.ts` (round-trip; wrong passphrase / tamper fails), `tests/main/env-vault.test.ts` (create → setGlobal → `envFor`; persists and re-unlocks).
- **e2e:** `tests/e2e/env-vars.spec.ts` — create a vault, add a global `FOO=bar7788`, spawn a PowerShell terminal, and assert `echo $env:FOO` prints the value. `tests/e2e/env-per-terminal.spec.ts` — open a pane's scoped manager, add a per-terminal var, and assert it persists after closing and reopening.

## Deferred / non-goals

- **External vault backends.** Bitwarden / Azure Key Vault / AWS Secrets Manager are deferred behind a future `SecretSource` seam — the encrypted-local store would become one implementation of that interface.

### Hardening follow-ups (noted from the security review)

These are quality/hardening items, not security holes — the five core constraints above all hold today. Tracked for a later pass:

- **Cache the derived key.** `persist()` currently re-runs scrypt (~80 ms, synchronous on the main loop) on every var mutation because it re-encrypts with a fresh salt each write. Pin one salt per vault, derive the key once on unlock/create, and reuse it (fresh IV per write keeps GCM safe) — or move to the async `scrypt`. Avoids brief main-loop stalls when adding several vars quickly.
- **Surface persist failures.** `EnvVault.persist()` is intentionally best-effort and swallows write errors; on Windows an AV file lock could silently drop a change. Surface a `persistError` through `env:state` so the UI can warn.
- **Least-privilege `env:get`.** `env:get` returns the whole `VaultData` (all per-terminal groups) though the UI only shows globals. Scope it to `getGlobals` / `getTerminal(envId)` when the per-terminal editing UI lands.

## Related

- [Architecture](../architecture.md) · [Workspaces](workspaces.md)
