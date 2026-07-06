/**
 * Agent CLI argument parsing (REQ-001 of 0024, formerly REQ-011 of 0017) — pure, so the exit-2
 * usage contract is unit-testable without a process. `main.ts` maps `{ ok: false }` to
 * usage-on-stderr + exit code 2.
 *
 * REQ-001 (0024-agent-daemonization): strictly ADDITIVE surface — `--daemon`, `--attach`,
 * `--ws=<token>`, `--socket=<path>`, `--idle-timeout-ms=<n>`. With NO mode flag the parse result
 * stays byte-identical to the shipped F16 shape (the frozen TEST-759 `toEqual` pin): every new
 * field is OMITTED (never a defined `undefined`-holding key) for legacy argv, so `Object.keys()`
 * on a legacy parse carries nothing new.
 *
 * `--daemon`/`--attach` each REQUIRE a scope — a `--ws=<token>` (which derives the workspace-keyed
 * socket/metadata/log names, locked D6′) or an explicit `--socket=<path>`. The token charset gate
 * `^[A-Za-z0-9_-]{1,64}$` is the injection/traversal guard: the token is interpolated into a
 * remote shell command AND a filesystem path (CONV-001/CONV-002).
 */

/** The workspace-scope token charset (REQ-001/REQ-009): injection- and traversal-safe. */
const WS_TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/

export type AgentArgs =
  | {
      ok: true
      ptyBackend: 'node-pty' | 'fake'
      /** Absent = the F16 stdio agent (default mode). */
      mode?: 'daemon' | 'attach'
      /** `--ws=<token>` — the workspace scope; derives the ws-keyed socket/metadata/log names. */
      wsToken?: string
      /** `--socket=<path>` — a named-pipe path on win32 (the REQ-016 portable test substrate). */
      socketPath?: string
      /** `--idle-timeout-ms=<n>` — positive integer only; overrides DAEMON_IDLE_TIMEOUT_DEFAULT_MS. */
      idleTimeoutMs?: number
    }
  | { ok: false; usage: string }

const USAGE =
  'usage: node termhalla-agent.cjs [--pty=node-pty|fake] [--daemon|--attach] ' +
  '[--ws=<token>] [--socket=<path>] [--idle-timeout-ms=<n>]   (default: --pty=node-pty, no mode = stdio agent; ' +
  '--daemon/--attach require a --ws or --socket scope)'

export const parseAgentArgs = (argv: string[]): AgentArgs => {
  let ptyBackend: 'node-pty' | 'fake' = 'node-pty'
  let mode: 'daemon' | 'attach' | undefined
  let wsToken: string | undefined
  let socketPath: string | undefined
  let idleTimeoutMs: number | undefined

  for (const arg of argv) {
    if (arg.startsWith('--pty=')) {
      const value = arg.slice('--pty='.length)
      if (value !== 'node-pty' && value !== 'fake') {
        return { ok: false, usage: `unknown --pty backend "${value}" — expected node-pty or fake\n${USAGE}` }
      }
      ptyBackend = value
    } else if (arg === '--daemon' || arg === '--attach') {
      const wanted: 'daemon' | 'attach' = arg === '--daemon' ? 'daemon' : 'attach'
      if (mode !== undefined && mode !== wanted) {
        return {
          ok: false,
          usage: `--daemon and --attach are mutually exclusive — pick exactly one mode\n${USAGE}`
        }
      }
      mode = wanted
    } else if (arg.startsWith('--ws=')) {
      const value = arg.slice('--ws='.length)
      if (!WS_TOKEN_RE.test(value)) {
        return {
          ok: false,
          usage: `--ws token "${value}" must match ${String(WS_TOKEN_RE)} — it names the workspace-keyed socket/metadata/log and is interpolated into a remote command and a filesystem path\n${USAGE}`
        }
      }
      wsToken = value
    } else if (arg.startsWith('--socket=')) {
      const value = arg.slice('--socket='.length)
      if (value.length === 0) {
        return { ok: false, usage: `--socket requires a non-empty path\n${USAGE}` }
      }
      socketPath = value
    } else if (arg.startsWith('--idle-timeout-ms=')) {
      const raw = arg.slice('--idle-timeout-ms='.length)
      const n = Number(raw)
      if (raw.length === 0 || !Number.isInteger(n) || n <= 0) {
        return {
          ok: false,
          usage: `--idle-timeout-ms must be a positive integer, got "${raw}"\n${USAGE}`
        }
      }
      idleTimeoutMs = n
    } else {
      return { ok: false, usage: `unknown argument "${arg}"\n${USAGE}` }
    }
  }

  // A --daemon/--attach mode REQUIRES a scope: --ws (derives ws-keyed names) or an explicit
  // --socket endpoint (REQ-001). Neither present is a usage error naming both scope flags.
  if (mode !== undefined && wsToken === undefined && socketPath === undefined) {
    return {
      ok: false,
      usage: `--${mode} requires a scope — pass --ws=<token> or --socket=<path>\n${USAGE}`
    }
  }

  return {
    ok: true,
    ptyBackend,
    ...(mode !== undefined ? { mode } : {}),
    ...(wsToken !== undefined ? { wsToken } : {}),
    ...(socketPath !== undefined ? { socketPath } : {}),
    ...(idleTimeoutMs !== undefined ? { idleTimeoutMs } : {})
  }
}
