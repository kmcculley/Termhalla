// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// Structural guards over the server-side sources: REQ-013 (no resize seam is even importable
// from the phone-remote server modules) and REQ-019 (unref'd, error-handled listener — the
// CONV-071 whole-lifetime 'error' handler and the long-lived-child abortability discipline).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const walk = (dir: string, ext: string): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, ext))
    else if (p.endsWith(ext)) out.push(p)
  }
  return out
}

describe('TEST-2637 REQ-013 no phone-remote module can reach a PTY resize', () => {
  it('src/main/phone-remote/* never references PtyManager or a pty resize seam', () => {
    const dir = resolve(root, 'src/main/phone-remote')
    expect(existsSync(dir), 'src/main/phone-remote must exist').toBe(true)
    const offenders: string[] = []
    for (const f of walk(dir, '.ts')) {
      const code = stripComments(readFileSync(f, 'utf8'))
      // The phone is a mirror: the only sanctioned resize is the MIRROR resize
      // (PaneReplay.resize, driven by the desktop). The pty seams must be unreachable.
      if (/PtyManager|ptyResize|pty:resize/.test(code)) offenders.push(f.replace(/\\/g, '/'))
    }
    expect(offenders, 'phone-remote modules must not import/name the pty resize surface').toEqual([])
  })

  it('the shared protocol module defines no resize message', () => {
    const code = stripComments(readFileSync(resolve(root, 'src/shared/phone-remote/protocol.ts'), 'utf8'))
    expect(code).not.toMatch(/['"]resize['"]/)
  })
})

describe('TEST-2641 REQ-019 abortable, unref-d, error-handled listener (structural)', () => {
  it('server.ts unrefs the listener/sockets so they never keep main alive', () => {
    const code = stripComments(readFileSync(resolve(root, 'src/main/phone-remote/server.ts'), 'utf8'))
    expect(code, 'the listener and accepted sockets must be unref()-d').toMatch(/\.unref\(\)/)
  })

  it('server.ts installs a whole-lifetime error handler (CONV-071: never only bind-time)', () => {
    const code = stripComments(readFileSync(resolve(root, 'src/main/phone-remote/server.ts'), 'utf8'))
    expect(code, "the listener needs a persistent 'error' handler").toMatch(/\.on\(\s*['"]error['"]/)
  })
})
