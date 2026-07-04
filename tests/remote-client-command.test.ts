// FROZEN test suite — feature 0020-ssh-tunnel-provisioned-bootstrap (phase 4).
// The pure ssh command builders (REQ-005/006/008/009/012/013): exact argv/command shapes and the
// argv-injection guards. These exact strings are the contract the fake shim parses (REQ-018) and
// the real remote shell executes — a change here is a wire-contract change.
import { describe, it, expect } from 'vitest'
import {
  buildSshExecArgv, remoteAgentInstallPath, buildAgentLaunchCommand, buildAgentUploadCommand,
  DEFAULT_REMOTE_AGENT_DIR, LAUNCH_ABSENT_EXIT, UPLOAD_SIZE_MISMATCH_EXIT
} from '../src/remote-client/ssh-command'

const seed = { host: 'h.example.com', user: 'kevin' }

describe('TEST-2012 REQ-005 exec-channel argv (favorites seeding rules; no TTY, no BatchMode)', () => {
  it('builds [user@host, cmd] with no port/identity', () => {
    expect(buildSshExecArgv(seed, 'echo hi')).toEqual(['kevin@h.example.com', 'echo hi'])
  })

  it('omits -p for port 22 and 0/unset', () => {
    expect(buildSshExecArgv({ ...seed, port: 22 }, 'c')).toEqual(['kevin@h.example.com', 'c'])
    expect(buildSshExecArgv({ ...seed, port: 0 }, 'c')).toEqual(['kevin@h.example.com', 'c'])
  })

  it('passes -p for a non-default port and -i for an identity file, in [-p][-i] order', () => {
    expect(buildSshExecArgv({ ...seed, port: 2222 }, 'c')).toEqual(['-p', '2222', 'kevin@h.example.com', 'c'])
    expect(buildSshExecArgv({ ...seed, identityFile: 'C:/keys/k' }, 'c'))
      .toEqual(['-i', 'C:/keys/k', 'kevin@h.example.com', 'c'])
    expect(buildSshExecArgv({ ...seed, port: 2222, identityFile: 'C:/keys/k' }, 'c'))
      .toEqual(['-p', '2222', '-i', 'C:/keys/k', 'kevin@h.example.com', 'c'])
  })

  it('the remote command is ONE final argv element; -t and BatchMode never appear', () => {
    const argv = buildSshExecArgv({ ...seed, port: 2222, identityFile: 'C:/k' }, 'a && b | c')
    expect(argv[argv.length - 1]).toBe('a && b | c')
    expect(argv).not.toContain('-t')
    expect(argv.join(' ')).not.toMatch(/BatchMode/i)
  })
})

describe('TEST-2013 REQ-006 argv-injection guards (specific, actionable — CONV-001)', () => {
  const cases: Array<[string, () => unknown, RegExp]> = [
    ['option-injection host', () => buildSshExecArgv({ host: '-oProxyCommand=calc', user: 'u' }, 'c'), /host/],
    ['whitespace user', () => buildSshExecArgv({ host: 'h', user: 'a b' }, 'c'), /user/],
    ['@ in host', () => buildSshExecArgv({ host: 'evil@h', user: 'u' }, 'c'), /host/],
    ['leading-dash user', () => buildSshExecArgv({ host: 'h', user: '-l' }, 'c'), /user/],
    ['out-of-range port', () => buildSshExecArgv({ host: 'h', user: 'u', port: 70000 }, 'c'), /port/],
    ['leading-dash identity', () => buildSshExecArgv({ host: 'h', user: 'u', identityFile: '-i' }, 'c'), /identit/i],
    ['empty host', () => buildSshExecArgv({ host: '', user: 'u' }, 'c'), /host/],
    ['control char in host', () => buildSshExecArgv({ host: 'h\nx', user: 'u' }, 'c'), /host/]
  ]
  for (const [label, run, field] of cases) {
    it(`rejects ${label}, naming the field`, () => {
      expect(run).toThrowError(field)
    })
  }

  it('rejects unsafe remote paths (spaces/quotes — the remote shell evaluates the command)', () => {
    expect(() => remoteAgentInstallPath("~/dir with space", '1.0.0')).toThrowError(/remoteAgentDir|path/i)
    expect(() => remoteAgentInstallPath("~/it's", '1.0.0')).toThrowError(/remoteAgentDir|path/i)
  })
})

describe('TEST-2014 REQ-008 versioned remote install path', () => {
  it('defaults to ~/.termhalla/agent and embeds the version in the file name', () => {
    expect(DEFAULT_REMOTE_AGENT_DIR).toBe('~/.termhalla/agent')
    expect(remoteAgentInstallPath(undefined, '1.2.3'))
      .toBe('~/.termhalla/agent/termhalla-agent-1.2.3.cjs')
    expect(remoteAgentInstallPath('~/custom/agents', '0.11.0'))
      .toBe('~/custom/agents/termhalla-agent-0.11.0.cjs')
  })

  it('rejects a version outside the safe charset (it enters a remote command string)', () => {
    expect(() => remoteAgentInstallPath(undefined, '1.0.0 && rm -rf ~')).toThrowError(/version/)
    expect(() => remoteAgentInstallPath(undefined, '')).toThrowError(/version/)
  })
})

describe('TEST-2015 REQ-009 launch command: probe-then-exec, absent sentinel 127', () => {
  it('pins the exact command for both backends and the sentinel constant', () => {
    const p = '~/.termhalla/agent/termhalla-agent-1.2.3.cjs'
    expect(buildAgentLaunchCommand(p, 'fake'))
      .toBe(`test -f ${p} && exec node ${p} --pty=fake || exit 127`)
    expect(buildAgentLaunchCommand(p, 'node-pty'))
      .toBe(`test -f ${p} && exec node ${p} --pty=node-pty || exit 127`)
    expect(LAUNCH_ABSENT_EXIT).toBe(127)
  })
})

describe('TEST-2016 REQ-012 upload command: mkdir, cat to nonce-tmp, wc -c verify, atomic mv, 93', () => {
  it('pins the exact command string for a fixed nonce', () => {
    const final = '~/.termhalla/agent/termhalla-agent-1.2.3.cjs'
    const tmp = `${final}.abc123.tmp`
    expect(buildAgentUploadCommand(final, 4096, 'abc123')).toBe(
      `mkdir -p ~/.termhalla/agent && cat > ${tmp} && [ "$(wc -c < ${tmp})" -eq 4096 ] && mv ${tmp} ${final} || { rm -f ${tmp}; exit 93; }`
    )
    expect(UPLOAD_SIZE_MISMATCH_EXIT).toBe(93)
  })

  it('rejects a non-positive or non-integer byte count (CONV-003: the limit is enforced, never silent)', () => {
    const final = '~/.termhalla/agent/termhalla-agent-1.2.3.cjs'
    expect(() => buildAgentUploadCommand(final, 0, 'abc123')).toThrowError(/byte/i)
    expect(() => buildAgentUploadCommand(final, 12.5, 'abc123')).toThrowError(/byte/i)
  })
})

describe('TEST-2017 REQ-013 nonce: validated at the builder, deterministic when injected', () => {
  it('rejects a nonce outside ^[A-Za-z0-9]+$ (it enters the remote command string)', () => {
    const final = '~/.termhalla/agent/termhalla-agent-1.2.3.cjs'
    expect(() => buildAgentUploadCommand(final, 1, 'x; rm -rf ~')).toThrowError(/nonce/)
    expect(() => buildAgentUploadCommand(final, 1, '')).toThrowError(/nonce/)
  })

  it('the default nonce source is crypto-shaped and collision-averse across calls', async () => {
    const { defaultNonce } = await import('../src/remote-client/bootstrap')
    const a = defaultNonce()
    const b = defaultNonce()
    expect(a).toMatch(/^[a-z0-9]{8,}$/)
    expect(b).toMatch(/^[a-z0-9]{8,}$/)
    expect(a).not.toBe(b)
  })
})
