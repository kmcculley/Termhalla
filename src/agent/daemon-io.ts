/**
 * Shared impure IO primitives for the daemon endpoint's two sides — `daemon-server.ts` (the
 * claim/serve side) and `bridge.ts` (the attach side). Extracted in the 2026-07-17 whole-project
 * quality audit (finding 32): the two modules carried byte-identical copies of `isAlive`/`delay`
 * and near-copies of the metadata reader / connect probe, and the metadata readers had already
 * drifted (the server copy dropped `proto`). One reader, one liveness check, one delay, one
 * connect-probe primitive — the server derives its boolean probe from the socket-returning one.
 *
 * Agent-tree-only (REQ-014): the client tree never imports this module.
 */
import { connect as netConnect, type Socket } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { validateDaemonMetadata } from './daemon-guard'

/** The validated ws-keyed daemon.json fields both sides consume (INCLUDING `proto` — D4′: the
 *  drift decision needs it, so the one shared reader always surfaces it). */
export interface DaemonMetadataOnDisk {
  pid: number
  version: string
  proto: number
  backend: string
}

/** Pid liveness via signal 0. EPERM means the pid EXISTS (owned by another user) — alive. */
export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Read + validate the ws-keyed daemon metadata file. `null` on absent/unreadable/invalid —
 *  NEVER a throw (the Definitions contract for "unreadable"). */
export const readDaemonMetadata = (metadataPath: string): DaemonMetadataOnDisk | null => {
  try {
    if (!existsSync(metadataPath)) return null
    const raw: unknown = JSON.parse(readFileSync(metadataPath, 'utf8'))
    const r = validateDaemonMetadata(raw)
    return r.ok ? { pid: r.meta.pid, version: r.meta.version, proto: r.meta.proto, backend: r.meta.backend } : null
  } catch {
    return null
  }
}

/** One connect attempt with its own timeout: the connected `Socket` on success (caller owns it),
 *  `null` on refusal/timeout (the attempt's socket destroyed) — never a throw. */
export const tryConnectOnce = (socketPath: string, timeoutMs: number): Promise<Socket | null> => new Promise((resolve) => {
  let settled = false
  const sock = netConnect(socketPath)
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    sock.destroy()
    resolve(null)
  }, timeoutMs)
  sock.once('connect', () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve(sock)
  })
  sock.once('error', () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve(null)
  })
})
