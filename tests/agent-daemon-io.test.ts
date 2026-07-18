// 2026-07-17 whole-project quality audit, finding 32: `bridge.ts` and `daemon-server.ts` carried
// copy-pasted IO helpers whose metadata readers had ALREADY drifted (the server copy dropped
// `proto`). `src/agent/daemon-io.ts` is the one shared implementation; these units pin its
// contract — most importantly that the ONE reader always surfaces `proto` (D4′: the drift
// decision consumes it).
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:net'
import { isAlive, delay, readDaemonMetadata, tryConnectOnce } from '../src/agent/daemon-io'
import { buildDaemonMetadata } from '../src/agent/daemon-guard'

describe('readDaemonMetadata — the ONE validated reader, proto included', () => {
  it('returns the full 4-field shape (pid/version/proto/backend) from a valid daemon.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'termhalla-daemon-io-'))
    try {
      const p = join(dir, 'daemon-w1.json')
      writeFileSync(p, JSON.stringify(buildDaemonMetadata({
        pid: 4711, version: '1.2.3', proto: 2, backend: 'fake', startedAt: '2026-07-17T00:00:00.000Z'
      })))
      expect(readDaemonMetadata(p)).toEqual({ pid: 4711, version: '1.2.3', proto: 2, backend: 'fake' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('absent / malformed JSON / invalid shape each yield null — never a throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'termhalla-daemon-io-'))
    try {
      expect(readDaemonMetadata(join(dir, 'nope.json'))).toBeNull()

      const bad = join(dir, 'bad.json')
      writeFileSync(bad, 'not-json{{{')
      expect(readDaemonMetadata(bad)).toBeNull()

      const wrongShape = join(dir, 'shape.json')
      writeFileSync(wrongShape, JSON.stringify({ pid: 1, version: 'x' })) // missing keys
      expect(readDaemonMetadata(wrongShape)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('isAlive / delay', () => {
  it('the current process is alive; delay resolves', async () => {
    expect(isAlive(process.pid)).toBe(true)
    await delay(1)
  })
})

describe('tryConnectOnce — Socket on success, null on refusal, never a throw', () => {
  const endpointPath = (dir: string): string =>
    process.platform === 'win32'
      ? `\\\\.\\pipe\\termhalla-daemon-io-${process.pid}-${Date.now()}`
      : join(dir, 'io.sock')

  it('resolves null for a path nothing listens on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'termhalla-daemon-io-'))
    try {
      expect(await tryConnectOnce(endpointPath(dir), 500)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves a live Socket when a listener answers (caller owns and destroys it)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'termhalla-daemon-io-'))
    const path = endpointPath(dir)
    const server: Server = createServer()
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(path, () => resolve())
      })
      const sock = await tryConnectOnce(path, 2000)
      expect(sock).not.toBeNull()
      sock?.destroy()
    } finally {
      server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
