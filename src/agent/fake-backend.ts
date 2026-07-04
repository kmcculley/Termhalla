/**
 * The deterministic fake pty backend (REQ-012) — the CI substance behind `--pty=fake`.
 *
 * A scripted in-process pseudo-shell: given the same input sequence it produces the same
 * output bytes, with no time, no randomness, and no scheduling (everything is emitted
 * synchronously; handles buffer emissions until the consumer attaches its callback, then
 * flush in order). It ships inside the agent deliberately, so CI exercises the EXACT artifact
 * `npm run build` produces — selection is an explicit opt-in flag, never a default.
 *
 * Scripted command contract (each command is a `\n`-terminated line; no tty echo):
 *   echo <text>   -> C marker, `<text>\r\n`, D;0, A
 *   cwd <path>    -> C marker, OSC 9;9;<path>, D;0, A     (drives the real CwdParser)
 *   pwd           -> C marker, resolved spawn cwd, D;0, A (makes REQ-007 cwd resolution visible)
 *   size          -> C marker, `size=<cols>x<rows>\r\n`, D;0, A (observes resize)
 *   exit <code>   -> C marker, D;<code>, then the handle exits with that code
 *   anything else -> C marker, `fake: unknown command "<line>"\r\n`, D;127, A
 *   kill()        -> the handle exits with code 0
 *
 * The OSC strings below are EMISSION only — parsing stays in the imported src/main/status/
 * modules (TEST-754 pins that boundary).
 */
import type { AgentPtyBackend, AgentPtyHandle, AgentSpawnOpts } from './pty-backend'

const MARKER_A = '\x1b]133;A\x07'
const MARKER_C = '\x1b]133;C\x07'
const markerD = (code: number): string => `\x1b]133;D;${code}\x07`
const oscCwd = (path: string): string => `\x1b]9;9;${path}\x07`
const PROMPT = 'fake$ '

/** Closure-based handle: every method is an OWN enumerable property, so a consumer (or a
 *  test spy) may safely `{ ...handle, kill: wrapped }` without losing the other methods —
 *  a class instance would strand its methods on the prototype. */
const createFakeHandle = (opts: AgentSpawnOpts): AgentPtyHandle => {
  let cols = opts.cols
  let rows = opts.rows
  const cwd = opts.cwd
  let line = ''
  let dead = false
  let dataCb: ((data: string) => void) | null = null
  let exitCb: ((code: number) => void) | null = null
  let pendingData: string[] = []
  let pendingExit: number | null = null

  const emit = (data: string): void => {
    if (dead) return
    if (dataCb) dataCb(data)
    else pendingData.push(data)
  }

  const exit = (code: number): void => {
    if (dead) return
    dead = true
    if (exitCb) exitCb(code)
    else pendingExit = code
  }

  const run = (cmd: string): void => {
    emit(MARKER_C)
    if (cmd === 'echo' || cmd.startsWith('echo ')) {
      emit(`${cmd.slice(5)}\r\n`)
    } else if (cmd.startsWith('cwd ')) {
      emit(oscCwd(cmd.slice(4)))
    } else if (cmd === 'pwd') {
      emit(`${cwd}\r\n`)
    } else if (cmd === 'size') {
      emit(`size=${cols}x${rows}\r\n`)
    } else if (cmd === 'exit' || cmd.startsWith('exit ')) {
      const parsed = cmd === 'exit' ? 0 : Number(cmd.slice(5))
      const code = Number.isInteger(parsed) && parsed >= 0 ? parsed : 1
      emit(markerD(code))
      exit(code)
      return
    } else {
      emit(`fake: unknown command "${cmd}"\r\n`)
      emit(markerD(127))
      emit(MARKER_A)
      emit(PROMPT)
      return
    }
    emit(markerD(0))
    emit(MARKER_A)
    emit(PROMPT)
  }

  emit(MARKER_A)
  emit(PROMPT)

  return {
    onData(cb: (data: string) => void): void {
      dataCb = cb
      const queued = pendingData
      pendingData = []
      for (const d of queued) cb(d)
    },
    onExit(cb: (code: number) => void): void {
      exitCb = cb
      if (pendingExit !== null) {
        const code = pendingExit
        pendingExit = null
        cb(code)
      }
    },
    write(data: string): void {
      if (dead) return
      line += data
      let nl = line.indexOf('\n')
      while (nl !== -1 && !dead) {
        const raw = line.slice(0, nl)
        line = line.slice(nl + 1)
        run(raw.endsWith('\r') ? raw.slice(0, -1) : raw)
        nl = line.indexOf('\n')
      }
    },
    resize(newCols: number, newRows: number): void {
      if (dead) return
      cols = newCols
      rows = newRows
    },
    kill(): void {
      exit(0)
    }
  }
}

export const createFakePtyBackend = (): AgentPtyBackend => ({
  spawn: (opts: AgentSpawnOpts): AgentPtyHandle => createFakeHandle(opts)
})
