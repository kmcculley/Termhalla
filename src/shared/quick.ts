import type { SshConnection, QuickStore, TmuxOptions } from './types'

/** A bare shell command separator. Each tmux option is run as its OWN `tmux set` command, separated
 *  by the *remote shell's* `;` — a plain token that passes through every quoting layer (node-pty →
 *  ConPTY → Windows `ssh.exe` argv parsing → remote shell) untouched. The previous design made the
 *  options arguments to a single `tmux new \; set …` and relied on a backslash-escaped `\;` reaching
 *  *tmux* as its separator; that backslash did not survive Windows `ssh.exe`'s `CommandLineToArgvW`,
 *  so tmux never started and the terminal's auto-reports leaked onto a bare remote shell prompt. */
const SHELL_SEP = ';'

/** The tmux `set -g` commands (each an argv fragment) for the given options, with defaults applied.
 *  Order is fixed for deterministic argv. `set -g` is server-global so it overrides the remote
 *  ~/.tmux.conf and applies to the attached session. */
export function tmuxOptionCommands(o: TmuxOptions = {}): string[][] {
  const cmds: string[][] = []
  if (o.mouse ?? true) cmds.push(['set', '-g', 'mouse', 'on'])
  if (o.fastEsc ?? true) cmds.push(['set', '-g', 'escape-time', '10'])
  if (o.trueColor ?? true) {
    cmds.push(['set', '-g', 'default-terminal', 'tmux-256color'])
    // single-quoted so the remote shell does not glob the '*'
    cmds.push(['set', '-ga', 'terminal-overrides', "',*:Tc'"])
  }
  if (o.historyLimit && o.historyLimit > 0) {
    cmds.push(['set', '-g', 'history-limit', String(Math.floor(o.historyLimit))])
  }
  if (o.clipboard ?? false) cmds.push(['set', '-g', 'set-clipboard', 'on'])
  return cmds
}

/** Build the argv after the `ssh` program: `[-t] [-p PORT] [-i IDENTITY] user@host [tmux …]`.
 *  When `tmuxSession` is set, force a remote PTY (-t) and run an attach-or-create tmux command so the
 *  session is reattached on reconnect/restart (the launch override is persisted and re-run verbatim).
 *
 *  With options enabled, each is applied as its own `tmux set` command joined by a bare shell `;`
 *  (see SHELL_SEP), then the session is `exec`'d so detaching exits ssh and SIGWINCH reaches tmux.
 *  `tmux set -g` auto-starts the server, so the globals are in place before `new -A -s` creates the
 *  session. With no options we keep the bare `tmux new -A -s NAME` (no `;`, no exec) form. */
export function buildSshArgs(c: SshConnection): string[] {
  // tmux forbids '.' and ':' in session names; collapse those and whitespace runs to '-'.
  const session = (c.tmuxSession ?? '').trim().replace(/[.:\s]+/g, '-').replace(/^-+/, '')
  const args: string[] = []
  if (session) args.push('-t')
  // Omit -p when the port is unset, the default (22), or an out-of-range 0.
  if (c.port && c.port !== 22) args.push('-p', String(c.port))
  if (c.identityFile && c.identityFile.length > 0) args.push('-i', c.identityFile)
  args.push(`${c.user}@${c.host}`)
  if (session) {
    const opts = tmuxOptionCommands(c.tmuxOptions)
    if (opts.length) {
      for (const cmd of opts) args.push('tmux', ...cmd, SHELL_SEP)
      args.push('exec', 'tmux', 'new', '-A', '-s', session)
    } else {
      args.push('tmux', 'new', '-A', '-s', session)
    }
  }
  return args
}

/** MRU: move/insert `value` at the front, de-dupe (strict equality by default, or a custom
 *  predicate), cap length. */
export function pushRecent<T>(
  list: T[], value: T, cap: number, eq: (a: T, b: T) => boolean = (a, b) => a === b
): T[] {
  return [value, ...list.filter(v => !eq(v, value))].slice(0, cap)
}

export const RECENT_DIR_CAP = 20

export const RECENT_CONN_CAP = 20

const normDir = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()

/** MRU for directories: skip empty + the home dir, de-dupe case/trailing-slash-insensitively.
 *  The most recent visited form wins — `dir` is stored verbatim, replacing any prior casing. */
export function nextRecentDirs(
  recent: string[], dir: string, home: string, cap: number = RECENT_DIR_CAP
): string[] {
  if (!dir) return recent
  if (home && normDir(dir) === normDir(home)) return recent
  return pushRecent(recent, dir, cap, (a, b) => normDir(a) === normDir(b))
}

export type PaletteAction =
  | 'new-connection' | 'pin-cwd'
  | 'new-terminal' | 'new-editor' | 'new-explorer' | 'new-orky'
  | 'new-workspace' | 'broadcast' | 'save-all' | 'refresh-cloud' | 'settings'
  | 'toggle-orky-queue' | 'capture-orky-work' | 'new-orky-workspace' | 'new-remote-workspace'

export type PaletteItem =
  | { kind: 'connection'; id: string; label: string; detail: string; search: string }
  // `label` is never SET on dir items (their display label derives from `path`, and
  // CommandPalette's render narrows on `kind`), but the optional field must stay declared:
  // frozen TEST-329 (tests/shared/keybindings-toggle-queue.test.ts:61) reads `item!.label` off
  // the UN-NARROWED PaletteItem union — `Array.prototype.find` does not narrow — so removing it
  // fails `npm run typecheck` with TS2339 (re-verified at the F6 review loopback, FINDING-019).
  // Removable only alongside a sanctioned tests-phase touch that narrows TEST-329's read.
  | { kind: 'dir'; path: string; favorite: boolean; search: string; label?: string }
  | { kind: 'action'; action: PaletteAction; label: string; search: string }

/** Build the merged, ordered palette list: connections (recent-first), favorite dirs,
 *  recent dirs (minus favorites), then the New-connection and (cwd-gated) Pin actions. */
export function buildPaletteItems(q: QuickStore, currentCwd: string): PaletteItem[] {
  const items: PaletteItem[] = []

  const order: string[] = q.recentConnections.filter(id => q.connections.some(c => c.id === id))
  for (const c of q.connections) if (!order.includes(c.id)) order.push(c.id)
  for (const id of order) {
    const c = q.connections.find(x => x.id === id)
    if (!c) continue
    const detail = `${c.user}@${c.host}${c.port && c.port !== 22 ? ':' + c.port : ''}`
    items.push({ kind: 'connection', id: c.id, label: c.name, detail,
      search: `${c.name} ${detail}`.toLowerCase() })
  }

  for (const d of q.favoriteDirs) {
    items.push({ kind: 'dir', path: d, favorite: true, search: d.toLowerCase() })
  }
  for (const d of q.recentDirs) {
    if (q.favoriteDirs.includes(d)) continue
    items.push({ kind: 'dir', path: d, favorite: false, search: d.toLowerCase() })
  }

  items.push({ kind: 'action', action: 'new-connection', label: 'New SSH connection…',
    search: 'new ssh connection' })
  if (currentCwd) {
    items.push({ kind: 'action', action: 'pin-cwd', label: `Pin current directory (${currentCwd})`,
      search: `pin current directory ${currentCwd.toLowerCase()}` })
  }
  return items
}

/** The command-menu items, appended to the palette ONLY when the query is non-empty
 *  (so the default connect/jump view stays uncluttered). Pure + order-stable. */
export function buildCommandItems(): PaletteItem[] {
  const cmd = (action: PaletteAction, label: string, search: string): PaletteItem =>
    ({ kind: 'action', action, label, search })
  return [
    cmd('new-terminal', 'New terminal', 'new terminal pane shell'),
    cmd('new-editor', 'New editor', 'new editor pane file'),
    cmd('new-explorer', 'New explorer…', 'new explorer pane folder directory'),
    cmd('new-orky', 'New Orky pane…', 'new orky pane project pipeline status'),
    cmd('new-workspace', 'New workspace', 'new workspace tab'),
    cmd('broadcast', 'Broadcast to all terminals', 'broadcast send all terminals'),
    cmd('save-all', 'Save all workspaces', 'save all workspaces'),
    cmd('refresh-cloud', 'Refresh cloud status', 'refresh cloud status'),
    cmd('settings', 'Settings', 'settings preferences options theme environment'),
    cmd('toggle-orky-queue', 'Toggle Orky decision queue', 'orky decision queue needs you human review'),
    cmd('capture-orky-work', 'Capture Orky work item…', 'capture orky work idea inbox'),
    cmd('new-orky-workspace', 'New Orky project workspace…', 'new orky project workspace cockpit'),
    cmd('new-remote-workspace', 'New remote workspace…', 'new remote workspace agent ssh home')
  ]
}

/** Case-insensitive substring filter; an empty/whitespace query returns the list unchanged. */
export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter(i => i.search.includes(q))
}
