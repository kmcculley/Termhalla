# Environment Variable Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Inject global + per-terminal env vars into terminals, with values encrypted at rest (AES-256-GCM, passphrase unlock).

**Architecture:** Pure crypto (`src/main/env-vault/crypto.ts`) + an `EnvVault` (encrypted file, in-memory after unlock) → injected into `PtyManager.spawn`; `env:*` IPC; a renderer `EnvManager` modal. Vault backends (Bitwarden/Azure/AWS) deferred.

**Spec:** `docs/superpowers/specs/2026-06-15-termhalla-env-vars-design.md`

---

## Task 1: Crypto core

**Files:** Create `src/main/env-vault/crypto.ts`; Test `tests/main/env-crypto.test.ts`.

- [ ] **Step 1: Failing test** — `tests/main/env-crypto.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { encryptJSON, decryptJSON } from '../../src/main/env-vault/crypto'

describe('env crypto', () => {
  it('round-trips data with the right passphrase', () => {
    const blob = encryptJSON({ a: 1, s: 'secret' }, 'pw')
    expect(decryptJSON(blob, 'pw')).toEqual({ a: 1, s: 'secret' })
  })
  it('throws on a wrong passphrase', () => {
    const blob = encryptJSON({ x: 1 }, 'right')
    expect(() => decryptJSON(blob, 'wrong')).toThrow()
  })
  it('throws on tampered ciphertext', () => {
    const blob = encryptJSON({ x: 1 }, 'pw')
    const bad = { ...blob, ct: Buffer.from('garbage').toString('base64') }
    expect(() => decryptJSON(bad, 'pw')).toThrow()
  })
})
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `src/main/env-vault/crypto.ts`:
```ts
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto'

export interface EncryptedBlob { v: 1; salt: string; iv: string; tag: string; ct: string }

function keyFrom(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32)
}

/** AES-256-GCM encrypt JSON under a passphrase-derived (scrypt) key. */
export function encryptJSON(data: unknown, passphrase: string): EncryptedBlob {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = keyFrom(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data), 'utf8')), cipher.final()])
  return {
    v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64')
  }
}

/** Decrypt; throws on a wrong passphrase or tampering (GCM auth failure). */
export function decryptJSON(blob: EncryptedBlob, passphrase: string): unknown {
  const key = keyFrom(passphrase, Buffer.from(blob.salt, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'))
  const pt = Buffer.concat([decipher.update(Buffer.from(blob.ct, 'base64')), decipher.final()])
  return JSON.parse(pt.toString('utf8'))
}
```
- [ ] **Step 4: Run, verify pass; typecheck. Commit:**
```bash
git add src/main/env-vault/crypto.ts tests/main/env-crypto.test.ts
git commit -m "feat(env): AES-256-GCM crypto (scrypt key) for the env vault"
```

---

## Task 2: EnvVault

**Files:** Create `src/main/env-vault/env-vault.ts`; Test `tests/main/env-vault.test.ts`.

- [ ] **Step 1: Failing test** — `tests/main/env-vault.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EnvVault } from '../../src/main/env-vault/env-vault'

const dirs: string[] = []
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'env-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('EnvVault', () => {
  it('create → setGlobal → envFor; persists and re-unlocks', () => {
    const dir = tmp()
    const v = new EnvVault(dir)
    expect(v.exists()).toBe(false)
    v.create('pw'); expect(v.isUnlocked()).toBe(true)
    v.setGlobal('FOO', 'bar')
    v.setTerminal('t1', 'FOO', 'override')
    v.setTerminal('t1', 'BAZ', 'qux')
    expect(v.envFor()).toEqual({ FOO: 'bar' })
    expect(v.envFor('t1')).toEqual({ FOO: 'override', BAZ: 'qux' })
    // Re-open from disk and unlock.
    const v2 = new EnvVault(dir)
    expect(v2.exists()).toBe(true)
    expect(v2.unlock('wrong')).toBe(false)
    expect(v2.isUnlocked()).toBe(false)
    expect(v2.unlock('pw')).toBe(true)
    expect(v2.envFor('t1')).toEqual({ FOO: 'override', BAZ: 'qux' })
  })
  it('envFor is empty while locked', () => {
    const v = new EnvVault(tmp())
    expect(v.envFor()).toEqual({})
  })
})
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `src/main/env-vault/env-vault.ts`:
```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { encryptJSON, decryptJSON, type EncryptedBlob } from './crypto'

export interface VaultData { global: Record<string, string>; terminals: Record<string, Record<string, string>> }

/** Encrypted-local env-var store. Decrypted data + passphrase live in memory only while unlocked. */
export class EnvVault {
  private data: VaultData | null = null
  private passphrase: string | null = null
  constructor(private readonly baseDir: string) {}
  private file(): string { return join(this.baseDir, 'env-vault.json') }

  exists(): boolean { return existsSync(this.file()) }
  isUnlocked(): boolean { return this.data !== null }
  current(): VaultData | null { return this.data }
  lock(): void { this.data = null; this.passphrase = null }

  create(passphrase: string): void {
    this.data = { global: {}, terminals: {} }; this.passphrase = passphrase; this.persist()
  }
  unlock(passphrase: string): boolean {
    try {
      const blob = JSON.parse(readFileSync(this.file(), 'utf8')) as EncryptedBlob
      const d = decryptJSON(blob, passphrase) as VaultData
      if (!d || typeof d !== 'object') return false
      this.data = { global: d.global ?? {}, terminals: d.terminals ?? {} }
      this.passphrase = passphrase
      return true
    } catch { return false }
  }
  setGlobal(name: string, value: string): void { if (!this.data) return; this.data.global[name] = value; this.persist() }
  removeGlobal(name: string): void { if (!this.data) return; delete this.data.global[name]; this.persist() }
  setTerminal(envId: string, name: string, value: string): void {
    if (!this.data) return
    ;(this.data.terminals[envId] ??= {})[name] = value
    this.persist()
  }
  removeTerminal(envId: string, name: string): void {
    if (!this.data) return
    const g = this.data.terminals[envId]; if (!g) return
    delete g[name]; if (Object.keys(g).length === 0) delete this.data.terminals[envId]
    this.persist()
  }
  envFor(envId?: string): Record<string, string> {
    if (!this.data) return {}
    return { ...this.data.global, ...(envId ? this.data.terminals[envId] ?? {} : {}) }
  }
  private persist(): void {
    if (!this.data || this.passphrase === null) return
    try { mkdirSync(this.baseDir, { recursive: true }); writeFileSync(this.file(), JSON.stringify(encryptJSON(this.data, this.passphrase))) }
    catch { /* best-effort */ }
  }
}
```
- [ ] **Step 4: Run, verify pass; typecheck. Commit:**
```bash
git add src/main/env-vault/env-vault.ts tests/main/env-vault.test.ts
git commit -m "feat(env): EnvVault (encrypted-local, unlock/create/setGlobal/setTerminal/envFor)"
```

---

## Task 3: Injection + IPC

**Files:** Modify `src/main/pty/pty-manager.ts`, `src/shared/ipc-contract.ts`, `src/shared/types.ts`, `src/preload/index.ts`, `src/main/ipc/register.ts`.

- [ ] **Step 1: PtyManager.spawn extraEnv** — add a final param `extraEnv?: Record<string, string>` to `spawn(...)`, and merge it into the env:
```ts
        env: sanitizeShellEnv({ ...process.env, ...(spec.env ?? {}), ...(extraEnv ?? {}) })
```

- [ ] **Step 2: Types** — add `envId?: string` to `TerminalConfig` (`types.ts`); add `envId?: string` to `PtySpawnArgs` (`ipc-contract.ts`).

- [ ] **Step 3: Contract** — in `CH` add:
```ts
  envState: 'env:state', envUnlock: 'env:unlock', envCreate: 'env:create', envLock: 'env:lock', envGet: 'env:get',
  envSetGlobal: 'env:setGlobal', envRemoveGlobal: 'env:removeGlobal', envSetTerminal: 'env:setTerminal', envRemoveTerminal: 'env:removeTerminal',
```
In `TermhallaApi` (import `VaultData` type — re-export it from `@shared/types`? simpler: define a renderer-facing `EnvVaultData = { global: Record<string,string>; terminals: Record<string, Record<string,string>> }` in `types.ts` and use it):
```ts
  onEnvState(cb: (state: { exists: boolean; unlocked: boolean }) => void): () => void
  envUnlock(passphrase: string): Promise<boolean>
  envCreate(passphrase: string): Promise<void>
  envLock(): void
  envGet(): Promise<EnvVaultData | null>
  envSetGlobal(name: string, value: string): void
  envRemoveGlobal(name: string): void
  envSetTerminal(envId: string, name: string, value: string): void
  envRemoveTerminal(envId: string, name: string): void
```
Add `export interface EnvVaultData { global: Record<string, string>; terminals: Record<string, Record<string, string>> }` to `types.ts` and make `EnvVault`'s `VaultData` structurally identical (or import it).

- [ ] **Step 4: Preload** — add the methods (`invoke` for unlock/create/get; `send` for the setters/lock; `on` for `onEnvState`). E.g.:
```ts
  envUnlock: (p) => ipcRenderer.invoke(CH.envUnlock, p),
  envCreate: (p) => ipcRenderer.invoke(CH.envCreate, p),
  envLock: () => ipcRenderer.send(CH.envLock),
  envGet: () => ipcRenderer.invoke(CH.envGet),
  envSetGlobal: (n, v) => ipcRenderer.send(CH.envSetGlobal, n, v),
  envRemoveGlobal: (n) => ipcRenderer.send(CH.envRemoveGlobal, n),
  envSetTerminal: (id, n, v) => ipcRenderer.send(CH.envSetTerminal, id, n, v),
  envRemoveTerminal: (id, n) => ipcRenderer.send(CH.envRemoveTerminal, id, n),
  onEnvState: (cb) => { const h = (_e: unknown, s: { exists: boolean; unlocked: boolean }) => cb(s); ipcRenderer.on(CH.envState, h as never); return () => ipcRenderer.removeListener(CH.envState, h as never) },
```

- [ ] **Step 5: register.ts** — import `EnvVault`; `const envVault = new EnvVault(userDataDir())`. Wire:
  - In the `ptySpawn` handler, compute and pass the env:
```ts
  ipcMain.handle(CH.ptySpawn, (_e, a: PtySpawnArgs) => {
    const shell = shells.find(s => s.id === a.shellId) ?? shells[0]
    tracker!.register(a.id)
    pty.spawn(a.id, shell, a.cwd, a.cols, a.rows, a.launch, envVault.envFor(a.envId))
  })
```
  - Add an `emitEnvState` helper and handlers:
```ts
  const emitEnvState = () => safeSend(CH.envState, { exists: envVault.exists(), unlocked: envVault.isUnlocked() })
  ipcMain.handle(CH.envUnlock, (_e, p: string) => { const ok = envVault.unlock(p); emitEnvState(); return ok })
  ipcMain.handle(CH.envCreate, (_e, p: string) => { envVault.create(p); emitEnvState() })
  ipcMain.on(CH.envLock, () => { envVault.lock(); emitEnvState() })
  ipcMain.handle(CH.envGet, () => envVault.current())
  ipcMain.on(CH.envSetGlobal, (_e, n: string, v: string) => { envVault.setGlobal(n, v); emitEnvState() })
  ipcMain.on(CH.envRemoveGlobal, (_e, n: string) => { envVault.removeGlobal(n); emitEnvState() })
  ipcMain.on(CH.envSetTerminal, (_e, id: string, n: string, v: string) => { envVault.setTerminal(id, n, v); emitEnvState() })
  ipcMain.on(CH.envRemoveTerminal, (_e, id: string, n: string) => { envVault.removeTerminal(id, n); emitEnvState() })
  win.webContents.once('did-finish-load', emitEnvState)
```

- [ ] **Step 6: Typecheck + build. Commit:**
```bash
git add src/main/pty/pty-manager.ts src/shared/ipc-contract.ts src/shared/types.ts src/preload/index.ts src/main/ipc/register.ts
git commit -m "feat(env): inject vault env on spawn + env:* IPC"
```

---

## Task 4: Store + spawn envId

**Files:** Modify `src/renderer/store.ts`, `src/renderer/components/TerminalPane.tsx`, `src/renderer/App.tsx`.

- [ ] **Step 1: store** — State:
```ts
  envVault: { exists: boolean; unlocked: boolean }
  setEnvState: (s: { exists: boolean; unlocked: boolean }) => void
```
initial `envVault: { exists: false, unlocked: false }`; action `setEnvState: (s) => set({ envVault: s })`.

- [ ] **Step 2: TerminalPane** — pass `envId` in the spawn args. In the `api.ptySpawn({ ... })` call add `envId: config.envId`.

- [ ] **Step 3: App** — subscribe: `useEffect(() => { const off = api.onEnvState(s => useStore.getState().setEnvState(s)); return off }, [])`.

- [ ] **Step 4: Typecheck. Commit:**
```bash
git add src/renderer/store.ts src/renderer/components/TerminalPane.tsx src/renderer/App.tsx
git commit -m "feat(env): store env state + pass envId on spawn"
```

---

## Task 5: EnvManager UI

**Files:** Create `src/renderer/components/EnvManager.tsx`; Modify `src/renderer/components/WorkspaceTabs.tsx`.

- [ ] **Step 1: Create `EnvManager.tsx`** — a portal modal driven by `env:get`/the env IPC. Behavior:
  - Reads `const env = useStore(s => s.envVault)`.
  - Local state: `passphrase`, `data: EnvVaultData | null` (loaded via `api.envGet()` when unlocked), and add-row fields.
  - **No vault (`!env.exists`)** → a "Set a passphrase" field + **Create** (`api.envCreate`).
  - **Locked (`exists && !unlocked`)** → passphrase field + **Unlock** (`api.envUnlock` → if false, show "Incorrect passphrase").
  - **Unlocked** → after unlock/create, `await api.envGet()` into `data`; render a **Global** section: each `data.global` entry as `NAME` + a password input (reveal toggle) + remove (`api.envRemoveGlobal`); an add row (name+value → `api.envSetGlobal`, then re-`envGet`). A **Lock** button (`api.envLock`). (Per-terminal editing can be a later follow-up; this version manages global vars + the unlock/create flow. Note in docs.)
  - Re-fetch `data` after each set/remove. `data-testid`s: `env-manager`, `env-passphrase`, `env-create`, `env-unlock`, `env-error`, `env-name`, `env-value`, `env-add`, `env-lock`, and per-row `env-row-<name>` / `env-del-<name>`.
  - `createPortal(..., document.body)`.

- [ ] **Step 2: WorkspaceTabs button** — import `EnvManager`; add `const [envOpen, setEnvOpen] = useState(false)`; a `🔑` button (`data-testid="env-button"`, title "Environment variables") near the others; render `{envOpen && <EnvManager onClose={() => setEnvOpen(false)} />}`.

- [ ] **Step 3: Typecheck + build. Commit:**
```bash
git add src/renderer/components/EnvManager.tsx src/renderer/components/WorkspaceTabs.tsx
git commit -m "feat(env): EnvManager modal (create/unlock/global vars) + 🔑 button"
```

---

## Task 6: e2e + verify + docs

- [ ] **Step 1: e2e** — `tests/e2e/env-vars.spec.ts`: launch (temp user-data-dir); open `env-button`; fill `env-passphrase` with `pw`, click `env-create`; add a global var (`env-name`=`FOO`, `env-value`=`bar7788`, `env-add`); close the manager; select the `powershell` shell in the shell picker; `add-first-terminal`; click the terminal, type `echo $env:FOO`, Enter; assert `.xterm-rows` contains `bar7788`. (The vault is unlocked in-session, so the new terminal's spawn injects `FOO`.)
- [ ] **Step 2: Full gate** — `npm run typecheck`, `npm test`, `npm run e2e` → green.
- [ ] **Step 3: Docs** — `docs/features/env-vars.md` (incl. the deferred-vault note + the security model); `CHANGELOG.md`. Commit.

---

## Self-review notes
- Spec coverage: crypto (T1), vault (T2), injection+IPC (T3), store/spawn (T4), UI (T5), e2e+docs (T6).
- Security: passphrase + decrypted values stay in main memory; only the encrypted blob is on disk; the workspace JSON stores only `envId`. Locked vault injects nothing. Vault backends deferred behind a future `SecretSource` seam.
- Note: per-terminal var EDITING UI is scoped to a follow-up; the data model + injection already support `envId`.
