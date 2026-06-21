import { describe, it, expect } from 'vitest'
import { buildSshArgs, tmuxOptionCommands, pushRecent, nextRecentDirs, buildPaletteItems, filterPaletteItems } from '@shared/quick'
import type { SshConnection } from '@shared/types'
import type { QuickStore } from '@shared/types'

const base: SshConnection = { id: 'c1', name: 'box', host: 'example.com', user: 'kev' }

// With any option on, each option is its own `tmux set` command joined by a bare shell `;`
// (which survives the Windows node-pty/ConPTY/ssh.exe/remote-shell quoting layers, unlike the old
// `\;` tmux separator), and the session is attached via `exec tmux new`. These are the sets for the
// on-by-default options (mouse + faster Esc + true color).
const DEFAULT_SETS = [
  'tmux', 'set', '-g', 'mouse', 'on', ';',
  'tmux', 'set', '-g', 'escape-time', '10', ';',
  'tmux', 'set', '-g', 'default-terminal', 'tmux-256color', ';',
  'tmux', 'set', '-ga', 'terminal-overrides', "',*:Tc'", ';'
]
// The attach-or-create, exec'd so detach exits ssh and SIGWINCH reaches tmux. Used only when at
// least one option is set; with no options we emit the bare `tmux new -A -s <name>` instead.
const attach = (s: string) => ['exec', 'tmux', 'new', '-A', '-s', s]

describe('buildSshArgs', () => {
  it('omits port when default (22) and identity when unset', () => {
    expect(buildSshArgs(base)).toEqual(['kev@example.com'])
    expect(buildSshArgs({ ...base, port: 22 })).toEqual(['kev@example.com'])
  })
  it('adds -p for a non-default port', () => {
    expect(buildSshArgs({ ...base, port: 2222 })).toEqual(['-p', '2222', 'kev@example.com'])
  })
  it('adds -i for an identity file', () => {
    expect(buildSshArgs({ ...base, identityFile: 'C:\\keys\\id' }))
      .toEqual(['-i', 'C:\\keys\\id', 'kev@example.com'])
  })
  it('orders port before identity before target', () => {
    expect(buildSshArgs({ ...base, port: 2200, identityFile: 'k' }))
      .toEqual(['-p', '2200', '-i', 'k', 'kev@example.com'])
  })
  it('leaves args unchanged when tmuxSession is unset or empty', () => {
    expect(buildSshArgs({ ...base, tmuxSession: '' })).toEqual(['kev@example.com'])
    expect(buildSshArgs({ ...base, tmuxSession: '   ' })).toEqual(['kev@example.com'])
  })
  it('prepends -t and emits per-option tmux set commands + exec attach when tmuxSession is set', () => {
    expect(buildSshArgs({ ...base, tmuxSession: 'main' }))
      .toEqual(['-t', 'kev@example.com', ...DEFAULT_SETS, ...attach('main')])
  })
  it('keeps -t before port/identity, host before the tmux command', () => {
    expect(buildSshArgs({ ...base, port: 2200, identityFile: 'k', tmuxSession: 'work' }))
      .toEqual(['-t', '-p', '2200', '-i', 'k', 'kev@example.com', ...DEFAULT_SETS, ...attach('work')])
  })
  it('sanitizes tmux session names (tmux forbids . and :, collapse whitespace)', () => {
    expect(buildSshArgs({ ...base, tmuxSession: ' my.session:1 ' }))
      .toEqual(['-t', 'kev@example.com', ...DEFAULT_SETS, ...attach('my-session-1')])
  })
  it('strips a leading dash produced by sanitization (tmux would treat it as a flag)', () => {
    expect(buildSshArgs({ ...base, tmuxSession: '.session' }))
      .toEqual(['-t', 'kev@example.com', ...DEFAULT_SETS, ...attach('session')])
    expect(buildSshArgs({ ...base, tmuxSession: ' :foo' }))
      .toEqual(['-t', 'kev@example.com', ...DEFAULT_SETS, ...attach('foo')])
  })
  it('treats an all-punctuation session name as tmux off', () => {
    expect(buildSshArgs({ ...base, tmuxSession: '...' })).toEqual(['kev@example.com'])
  })
  it('emits the legacy argv when tmuxSession is entirely absent', () => {
    expect(buildSshArgs(base)).toEqual(['kev@example.com'])
  })
  it('mouse off drops only the mouse command; other defaults remain', () => {
    expect(buildSshArgs({ ...base, tmuxSession: 'main', tmuxOptions: { mouse: false } }))
      .toEqual(['-t', 'kev@example.com',
        'tmux', 'set', '-g', 'escape-time', '10', ';',
        'tmux', 'set', '-g', 'default-terminal', 'tmux-256color', ';',
        'tmux', 'set', '-ga', 'terminal-overrides', "',*:Tc'", ';',
        ...attach('main')])
  })
  it('all options off appends only the bare attach-or-create command (no exec, no sets)', () => {
    expect(buildSshArgs({ ...base, tmuxSession: 'main',
      tmuxOptions: { mouse: false, trueColor: false, fastEsc: false, clipboard: false } }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'main'])
  })
  it('emits history-limit only for a positive number', () => {
    const off = { mouse: false, trueColor: false, fastEsc: false }
    expect(buildSshArgs({ ...base, tmuxSession: 'main', tmuxOptions: { ...off, historyLimit: 50000 } }))
      .toEqual(['-t', 'kev@example.com',
        'tmux', 'set', '-g', 'history-limit', '50000', ';', ...attach('main')])
    expect(buildSshArgs({ ...base, tmuxSession: 'main', tmuxOptions: { ...off, historyLimit: 0 } }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'main'])
  })
  it('clipboard on appends set-clipboard', () => {
    expect(buildSshArgs({ ...base, tmuxSession: 'main',
      tmuxOptions: { mouse: false, trueColor: false, fastEsc: false, clipboard: true } }))
      .toEqual(['-t', 'kev@example.com',
        'tmux', 'set', '-g', 'set-clipboard', 'on', ';', ...attach('main')])
  })
  it('no tmux session ignores tmuxOptions entirely', () => {
    expect(buildSshArgs({ ...base, tmuxOptions: { mouse: true } })).toEqual(['kev@example.com'])
  })

  describe('tmuxOptionCommands', () => {
    it('applies on-by-default options for empty input', () => {
      expect(tmuxOptionCommands()).toEqual([
        ['set', '-g', 'mouse', 'on'],
        ['set', '-g', 'escape-time', '10'],
        ['set', '-g', 'default-terminal', 'tmux-256color'],
        ['set', '-ga', 'terminal-overrides', "',*:Tc'"]
      ])
    })
    it('returns an empty list when every option is off', () => {
      expect(tmuxOptionCommands({ mouse: false, trueColor: false, fastEsc: false, clipboard: false }))
        .toEqual([])
    })
  })
})

describe('pushRecent', () => {
  it('prepends, de-dupes to front, and caps', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b', 5)).toEqual(['b', 'a', 'c'])
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
    expect(pushRecent(['a', 'b', 'c'], 'c', 3)).toEqual(['c', 'a', 'b'])
  })
  it('de-dupes with a custom equality predicate', () => {
    const ci = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
    expect(pushRecent(['A', 'b'], 'a', 5, ci)).toEqual(['a', 'b'])
  })
})

describe('nextRecentDirs', () => {
  const home = 'C:\\Users\\kev'
  it('prepends a visited dir and de-dupes case-insensitively', () => {
    expect(nextRecentDirs(['C:\\a'], 'C:\\B', home)).toEqual(['C:\\B', 'C:\\a'])
    expect(nextRecentDirs(['C:\\a', 'C:\\b'], 'c:\\A', home)).toEqual(['c:\\A', 'C:\\b'])
  })
  it('skips the home directory (trailing-slash/case insensitive)', () => {
    expect(nextRecentDirs(['C:\\a'], 'C:\\Users\\kev\\', home)).toEqual(['C:\\a'])
  })
  it('ignores an empty dir and respects the cap', () => {
    expect(nextRecentDirs(['x'], '', home)).toEqual(['x'])
    expect(nextRecentDirs(['a', 'b'], 'c', home, 2)).toEqual(['c', 'a'])
  })
})

const quick: QuickStore = {
  connections: [
    { id: 'c1', name: 'alpha', host: 'a.example', user: 'kev' },
    { id: 'c2', name: 'beta', host: 'b.example', user: 'kev', port: 2222 }
  ],
  recentConnections: ['c2'],
  favoriteDirs: ['C:\\proj'],
  recentDirs: ['C:\\proj', 'C:\\work'],
  templates: [],
  themePresets: []
}

describe('buildPaletteItems', () => {
  it('orders recent connections first, then the rest', () => {
    const items = buildPaletteItems(quick, 'C:\\cwd')
    const conns = items.filter(i => i.kind === 'connection')
    expect(conns.map(i => (i as { id: string }).id)).toEqual(['c2', 'c1'])
  })
  it('lists favorite dirs, then recent dirs that are not already favorites', () => {
    const dirs = buildPaletteItems(quick, 'C:\\cwd').filter(i => i.kind === 'dir') as
      { path: string; favorite: boolean }[]
    expect(dirs).toEqual([
      { kind: 'dir', path: 'C:\\proj', favorite: true, search: 'c:\\proj' },
      { kind: 'dir', path: 'C:\\work', favorite: false, search: 'c:\\work' }
    ])
  })
  it('always offers New SSH connection, and Pin only when a cwd is known', () => {
    const withCwd = buildPaletteItems(quick, 'C:\\cwd').filter(i => i.kind === 'action')
    expect(withCwd.map(i => (i as { action: string }).action)).toEqual(['new-connection', 'pin-cwd'])
    const noCwd = buildPaletteItems(quick, '').filter(i => i.kind === 'action')
    expect(noCwd.map(i => (i as { action: string }).action)).toEqual(['new-connection'])
  })
})

describe('filterPaletteItems', () => {
  const items = buildPaletteItems(quick, 'C:\\cwd')
  it('returns everything for an empty query', () => {
    expect(filterPaletteItems(items, '   ')).toEqual(items)
  })
  it('substring-matches name/host/path case-insensitively', () => {
    expect(filterPaletteItems(items, 'beta').map(i => i.kind)).toEqual(['connection'])
    expect(filterPaletteItems(items, 'work').map(i => i.kind)).toEqual(['dir'])
    expect(filterPaletteItems(items, 'b.example').map(i => i.kind)).toEqual(['connection'])
  })
})
