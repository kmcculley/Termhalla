/**
 * The deterministic fake pty backend (REQ-012 of 0017; flow-control modeling REQ-010/REQ-011
 * of 0018) — the CI substance behind `--pty=fake`.
 *
 * A scripted in-process pseudo-shell: given the same input sequence it produces the same
 * output bytes, with no time, no randomness, and no scheduling (everything is emitted
 * synchronously; handles buffer emissions until the consumer attaches its callback, then
 * flush in order). It ships inside the agent deliberately, so CI exercises the EXACT artifact
 * `npm run build` produces — selection is an explicit opt-in flag, never a default.
 *
 * Scripted command contract (each command is a `\n`-terminated line; no tty echo):
 *   echo <text>       -> C marker, `<text>\r\n`, D;0, A
 *   cwd <path>        -> C marker, OSC 9;9;<path>, D;0, A     (drives the real CwdParser)
 *   pwd               -> C marker, resolved spawn cwd, D;0, A (makes REQ-007 cwd resolution visible)
 *   size              -> C marker, `size=<cols>x<rows>\r\n`, D;0, A (observes resize)
 *   exit <code>       -> C marker, D;<code>, then the handle exits with that code
 *   flood <n> <bytes> -> C marker, exactly <n> emissions of exactly <bytes> deterministic
 *                        filler units, D;0, A (0018 REQ-011 — the cat-a-huge-file source;
 *                        malformed/oversized args -> one actionable line, D;1, A, alive)
 *   anything else     -> C marker, `fake: unknown command "<line>"\r\n`, D;127, A
 *   kill()            -> the handle exits with code 0 (never deferred by a pause)
 *
 * Flow control (0018 REQ-010): while `pause()`d the handle DELIVERS nothing — output produced
 * by writes processed while paused queues in order; `resume()` flushes synchronously (a
 * consumer callback may re-pause mid-flush and the remainder stays queued). A SCRIPTED `exit`
 * while paused defers until resume has flushed all queued data (exit-last preserved); `kill()`
 * is the owner's action and exits immediately. Both pause() and resume() are idempotent.
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

/** Flood safety bound (REQ-011): a scripted flood may not exceed this many total units. */
const FLOOD_MAX_TOTAL_UNITS = 16_777_216
/** Fixed repeating filler — deterministic by construction, no randomness (REQ-011). */
const FLOOD_FILLER = '0123456789abcdefghijklmnopqrstuvwxyz'
const floodChunk = (units: number): string =>
  FLOOD_FILLER.repeat(Math.ceil(units / FLOOD_FILLER.length)).slice(0, units)

/** Closure-based handle: every method is an OWN enumerable property, so a consumer (or a
 *  test spy) may safely `{ ...handle, kill: wrapped }` without losing the other methods —
 *  a class instance would strand its methods on the prototype. */
const createFakeHandle = (opts: AgentSpawnOpts): AgentPtyHandle => {
  let cols = opts.cols
  let rows = opts.rows
  const cwd = opts.cwd
  let line = ''
  let dead = false
  let paused = false
  /** A scripted exit was deferred by a pause: the shell is GONE (later input is inert,
   *  FINDING-002) even though the exit callback waits for the queue to flush. */
  let closing = false
  let dataCb: ((data: string) => void) | null = null
  let exitCb: ((code: number) => void) | null = null
  const pendingData: string[] = []
  let pendingExit: number | null = null
  /** A scripted exit that arrived while paused; delivered only after resume flushes. */
  let deferredExit: number | null = null

  const emit = (data: string): void => {
    if (dead) return
    if (paused || dataCb === null) pendingData.push(data)
    else dataCb(data)
  }

  /** Deliver queued data in order. A callback may re-pause mid-flush (the session's flow
   *  gate does exactly that when the flood re-crosses its window) — the loop guard leaves
   *  the remainder queued for the next resume. */
  const flushPending = (): void => {
    if (dataCb === null) return
    while (pendingData.length > 0 && !paused && !dead) {
      dataCb(pendingData.shift() as string)
    }
  }

  const exit = (code: number): void => {
    if (dead) return
    if (paused) {
      // Scripted exit while paused: exit-last (after the queued data flushes on resume),
      // but the shell is gone NOW — later buffered input must be inert (FINDING-002).
      deferredExit = code
      closing = true
      return
    }
    dead = true
    if (exitCb) exitCb(code)
    else pendingExit = code
  }

  const runFlood = (cmd: string): void => {
    const parts = cmd.split(' ').filter((p) => p.length > 0)
    const chunks = Number(parts[1])
    const chunkBytes = Number(parts[2])
    const wellFormed = parts.length === 3 &&
      Number.isInteger(chunks) && chunks > 0 &&
      Number.isInteger(chunkBytes) && chunkBytes > 0 &&
      chunks * chunkBytes <= FLOOD_MAX_TOTAL_UNITS
    if (!wellFormed) {
      emit(`fake: flood expects "flood <chunks> <chunkBytes>" with positive integers and ` +
        `chunks*chunkBytes <= ${FLOOD_MAX_TOTAL_UNITS}, got "${cmd}"\r\n`)
      emit(markerD(1))
      emit(MARKER_A)
      emit(PROMPT)
      return
    }
    const chunk = floodChunk(chunkBytes)
    for (let i = 0; i < chunks; i++) emit(chunk)
    emit(markerD(0))
    emit(MARKER_A)
    emit(PROMPT)
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
    } else if (cmd === 'flood' || cmd.startsWith('flood ')) {
      runFlood(cmd)
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
      if (!paused) flushPending()
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
      if (dead || closing) return // a deferred scripted exit leaves no shell to type at
      line += data
      let nl = line.indexOf('\n')
      while (nl !== -1 && !dead && !closing) {
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
    pause(): void {
      paused = true // idempotent: pausing while paused changes nothing
    },
    resume(): void {
      if (!paused) return // idempotent: resuming while flowing is a no-op
      paused = false
      flushPending()
      if (deferredExit !== null && !paused && pendingData.length === 0) {
        const code = deferredExit
        deferredExit = null
        exit(code)
      }
    },
    kill(): void {
      // The owner's kill is never deferred: release the pause (undelivered queued output is
      // discarded with the pane, as a real kill would) and exit now.
      paused = false
      deferredExit = null
      exit(0)
    }
  }
}

export const createFakePtyBackend = (): AgentPtyBackend => ({
  spawn: (opts: AgentSpawnOpts): AgentPtyHandle => createFakeHandle(opts)
})
