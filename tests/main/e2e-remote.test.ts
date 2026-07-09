// The e2e harness must be able to point remote-workspace connects at the fake-ssh shim (the same
// stand-in every vitest integration suite drives) so a REAL connected session can run in-app with
// no network and no native pty. `TERMHALLA_E2E_REMOTE_SSH` is set only by the remote e2e specs;
// unset, the override must be absent so the shipped app's connect flow is untouched — the exact
// contract e2e-presentation.ts established for window presentation.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { e2eRemoteOverride } from '../../src/main/e2e-remote'

const walk = (dir: string, ext: string): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, ext))
    else if (p.endsWith(ext)) out.push(p)
  }
  return out
}

describe('e2eRemoteOverride', () => {
  it('parses the harness JSON into an ssh program override', () => {
    const raw = JSON.stringify({ program: 'C:\\node\\node.exe', prefixArgs: ['C:\\repo\\tests\\fixtures\\fake-ssh.mjs'] })
    expect(e2eRemoteOverride(raw)).toEqual({
      ssh: { program: 'C:\\node\\node.exe', prefixArgs: ['C:\\repo\\tests\\fixtures\\fake-ssh.mjs'] },
      ptyBackend: 'fake'
    })
  })

  it('always forces the fake pty backend — the harness may never run the native one', () => {
    // Even a raw value that tries to smuggle a backend choice is pinned to 'fake': the var exists
    // solely for the shim path, and a native backend under the harness would be a silent lie
    // (no Linux target, no prebuilt) discovered only as a hang.
    const raw = JSON.stringify({ program: 'node', prefixArgs: [], ptyBackend: 'node-pty' })
    expect(e2eRemoteOverride(raw)?.ptyBackend).toBe('fake')
  })

  it('defaults prefixArgs to [] when absent or malformed', () => {
    expect(e2eRemoteOverride(JSON.stringify({ program: 'node' }))?.ssh.prefixArgs).toEqual([])
    expect(e2eRemoteOverride(JSON.stringify({ program: 'node', prefixArgs: [1, 2] }))?.ssh.prefixArgs).toEqual([])
  })

  it('is absent (production behavior) when unset, empty, malformed, or missing a program', () => {
    expect(e2eRemoteOverride(undefined)).toBeUndefined()
    expect(e2eRemoteOverride('')).toBeUndefined()
    expect(e2eRemoteOverride('not json')).toBeUndefined()
    expect(e2eRemoteOverride('42')).toBeUndefined()
    expect(e2eRemoteOverride('null')).toBeUndefined()
    expect(e2eRemoteOverride(JSON.stringify({ prefixArgs: ['x'] }))).toBeUndefined()
    expect(e2eRemoteOverride(JSON.stringify({ program: '' }))).toBeUndefined()
  })

  it('reads the harness env by default', () => {
    const saved = process.env.TERMHALLA_E2E_REMOTE_SSH
    try {
      process.env.TERMHALLA_E2E_REMOTE_SSH = JSON.stringify({ program: 'node', prefixArgs: ['shim.mjs'] })
      expect(e2eRemoteOverride()).toEqual({ ssh: { program: 'node', prefixArgs: ['shim.mjs'] }, ptyBackend: 'fake' })
      delete process.env.TERMHALLA_E2E_REMOTE_SSH
      expect(e2eRemoteOverride()).toBeUndefined()
    } finally {
      if (saved === undefined) delete process.env.TERMHALLA_E2E_REMOTE_SSH
      else process.env.TERMHALLA_E2E_REMOTE_SSH = saved
    }
  })
})

describe('no regression seam', () => {
  it('the remote transport override is decided only through e2e-remote.ts', () => {
    // Same discipline as TERMHALLA_E2E_WINDOW: comments may NAME the variable, only code that
    // READS it is a regression seam. Scans src/main AND src/remote-client (the spawn seam lives
    // there) so no second reader can ever fork the decision.
    const offenders: string[] = []
    for (const root of ['src/main', 'src/remote-client']) {
      for (const f of walk(resolve(process.cwd(), root), '.ts')) {
        const norm = f.replace(/\\/g, '/')
        if (norm.endsWith('src/main/e2e-remote.ts')) continue
        const code = readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
        if (/TERMHALLA_E2E_REMOTE_SSH/.test(code)) offenders.push(norm)
      }
    }
    expect(offenders, 'read the override via e2eRemoteOverride() from src/main/e2e-remote.ts instead of the env var').toEqual([])
  })

  it('services.ts threads the override into the provisioned connect', () => {
    // The seam is only real if the composition root consumes it: the connect call must spread
    // e2eRemoteOverride() so `ssh` + `ptyBackend` reach connectWithProvisioning when (and only
    // when) the harness sets the var.
    const src = readFileSync(resolve(process.cwd(), 'src/main/services.ts'), 'utf8')
    expect(src).toMatch(/e2eRemoteOverride\s*\(/)
  })
})
