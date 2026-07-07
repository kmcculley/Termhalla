// 2026-07-06 quality-audit Group A #1: chokidar v4 re-emits non-ENOENT/ENOTDIR watch errors
// (Windows `EPERM ... watch` on deleting a watched dir, inotify ENOSPC). With ZERO 'error'
// listeners the emit throws uncaught in the main process — Electron's default handler raises a
// modal error dialog that freezes the whole app. Every main-process watcher must therefore be
// created through safeWatch, which guarantees the listener.
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { attachWatcherErrorGuard } from '../../src/main/safe-watcher'

const walk = (dir: string, ext: string): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, ext))
    else if (p.endsWith(ext)) out.push(p)
  }
  return out
}

describe('safeWatch error guard', () => {
  it('an unguarded emitter throws on error with zero listeners (the failure mode being guarded)', () => {
    const em = new EventEmitter()
    expect(() => em.emit('error', new Error('boom'))).toThrow('boom')
  })

  it('a guarded watcher survives an error event: warns, never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const em = new EventEmitter()
      attachWatcherErrorGuard(em, 'test-tag')
      expect(() => em.emit('error', new Error('EPERM: operation not permitted, watch'))).not.toThrow()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('test-tag')
    } finally {
      warn.mockRestore()
    }
  })

  it('every chokidar.watch call in src/main goes through safe-watcher.ts (no regression seam)', () => {
    const offenders: string[] = []
    for (const f of walk(resolve(process.cwd(), 'src/main'), '.ts')) {
      const norm = f.replace(/\\/g, '/')
      if (norm.endsWith('src/main/safe-watcher.ts')) continue
      if (/\bchokidar\.watch\s*\(/.test(readFileSync(f, 'utf8'))) offenders.push(norm)
    }
    expect(offenders, 'call safeWatch() from src/main/safe-watcher.ts instead — it guarantees the error listener').toEqual([])
  })
})
