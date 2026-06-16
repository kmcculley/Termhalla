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
