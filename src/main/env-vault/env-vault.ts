import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { encryptJSON, decryptJSON, type EncryptedBlob } from './crypto'

export interface VaultData { global: Record<string, string>; terminals: Record<string, Record<string, string>> }

/** On-disk payload schema version. Legacy vaults (written before versioning) carry no
 *  `version` field and are read as v1. */
export const VAULT_VERSION = 1

/** Exponential backoff bounds for repeated failed unlock attempts (anti-brute-force). */
export const UNLOCK_BACKOFF_BASE_MS = 1000
export const UNLOCK_BACKOFF_MAX_MS = 30_000

function isStringMap(v: unknown): v is Record<string, string> {
  if (v === undefined) return true                 // absent is fine; defaults to {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v).every(x => typeof x === 'string')
}

function isNestedStringMap(v: unknown): v is Record<string, Record<string, string>> {
  if (v === undefined) return true
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v).every(isStringMap)
}

/**
 * Validate a decrypted vault payload into `VaultData`, returning null when the shape is
 * wrong. Crucially this REJECTS (rather than coerces to empty) a present-but-malformed
 * `global`/`terminals` or a too-new `version` — otherwise a structurally-unexpected decrypt
 * would silently unlock to empty maps and the next setGlobal would overwrite the real
 * encrypted contents with that empty version (total silent data loss).
 */
export function parseVaultData(d: unknown): VaultData | null {
  if (!d || typeof d !== 'object') return null
  const o = d as Record<string, unknown>
  if (o.version !== undefined && (typeof o.version !== 'number' || o.version > VAULT_VERSION)) return null
  if (!isStringMap(o.global)) return null
  if (!isNestedStringMap(o.terminals)) return null
  return { global: { ...(o.global ?? {}) }, terminals: { ...(o.terminals ?? {}) } }
}

/** Encrypted-local env-var store. Decrypted data + passphrase live in memory only while unlocked. */
export class EnvVault {
  private data: VaultData | null = null
  private passphrase: string | null = null
  private unlockFailures = 0
  private backoffUntil = 0
  constructor(private readonly baseDir: string) {}
  private file(): string { return join(this.baseDir, 'env-vault.json') }

  exists(): boolean { return existsSync(this.file()) }
  isUnlocked(): boolean { return this.data !== null }
  current(): VaultData | null { return this.data }
  lock(): void { this.data = null; this.passphrase = null }

  create(passphrase: string): void {
    this.data = { global: {}, terminals: {} }; this.passphrase = passphrase; this.persist()
  }

  /** Attempt to unlock. Enforces an exponential backoff after failures so the throttle can't
   *  be bypassed by calling unlock directly. `now` is injectable for testing. */
  unlock(passphrase: string, now: number = Date.now()): boolean {
    if (now < this.backoffUntil) return false
    const ok = this.tryDecrypt(passphrase)
    if (ok) { this.unlockFailures = 0; this.backoffUntil = 0 }
    else {
      this.unlockFailures++
      this.backoffUntil = now + Math.min(UNLOCK_BACKOFF_BASE_MS * 2 ** this.unlockFailures, UNLOCK_BACKOFF_MAX_MS)
    }
    return ok
  }

  private tryDecrypt(passphrase: string): boolean {
    try {
      const blob = JSON.parse(readFileSync(this.file(), 'utf8')) as EncryptedBlob
      const data = parseVaultData(decryptJSON(blob, passphrase))
      if (!data) return false
      this.data = data
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
  /** Throws if the encrypted write fails. Callers that report success to the user (create/setGlobal/
   *  setTerminal, wired as `invoke`) must let it propagate so the UI can avoid a false "saved";
   *  best-effort callers (the remove handlers) swallow it at the IPC boundary instead. */
  private persist(): void {
    if (!this.data || this.passphrase === null) return
    const payload = { version: VAULT_VERSION, ...this.data }
    mkdirSync(this.baseDir, { recursive: true })
    writeFileSync(this.file(), JSON.stringify(encryptJSON(payload, this.passphrase)))
  }
}
