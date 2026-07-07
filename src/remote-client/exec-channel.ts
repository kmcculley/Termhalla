/**
 * The ONE ssh exec-channel scaffold (2026-07-06 quality audit, Group C #9): every one-shot
 * command channel — the F19 artifact upload, the F22 node-pty probe and install — used to
 * repeat the same ~50-line spawn/settle/abort/teardown ritual. `runSshExecChannel` owns that
 * discipline once, parameterized by the pieces that actually differ (the stdin payload, an
 * optional early-settling stdout observer, and the abort/spawn-error/exit outcome builders),
 * so a fix to the shared pump (an abort race, a teardown edge) lands in one place.
 *
 * The interactive handshake pump (`connectAgent`/`connectDaemonAgent`) is a DIFFERENT shape —
 * it keeps stdin open and hands out a live session — and lives in `connect-pump.ts`.
 */
import { randomBytes } from 'node:crypto'
import { spawnSsh, DEFAULT_SSH_PROGRAM } from './ssh-spawn'
import type { SshProgramOverride } from './ssh-spawn'

export const STDERR_TAIL_CHARS = 400

/** Strip C0/C1 control bytes (including ESC) so remote stderr can never smuggle terminal
 *  escape sequences into diagnostic strings a UI will later render (F19 FINDING-001). Built
 *  from char codes rather than literal escape ranges in source text. (prebuilt.ts keeps its
 *  own copy BY DESIGN — that module is deliberately dependency-free.) */
const CONTROL_CHARS_RE = ((): RegExp => {
  const codes: number[] = []
  for (let i = 0; i <= 0x1f; i++) codes.push(i)
  codes.push(0x7f)
  for (let i = 0x80; i <= 0x9f; i++) codes.push(i)
  return new RegExp(`[${codes.map((c) => String.fromCharCode(c)).join('')}]+`, 'g')
})()
export const sanitizeStderr = (text: string): string => text.replace(CONTROL_CHARS_RE, ' ')

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Crypto-random temp-file nonce (REQ-013); injectable via `options.nonce` for
 *  deterministic tests. 16 lowercase hex chars. */
export const defaultNonce = (): string => randomBytes(8).toString('hex')

export interface ExecChannelSpec<R> {
  argv: string[]
  ssh?: SshProgramOverride
  signal?: AbortSignal
  /** Bytes written to stdin once the handlers are wired (the abort state is re-checked first —
   *  a listener added to an already-aborted signal never fires). Stdin is always end()ed. */
  stdinPayload?: Buffer
  /** Raw stdout observer; may settle early (the probe's sentinel parse tears the child down
   *  the moment a parseable line exists). Never called after settle. Channels whose command
   *  produces no meaningful stdout simply omit it. */
  onStdout?: (chunk: Buffer, settle: (r: R) => void) => void
  /** The abort outcome — used for a mid-flight abort AND for a signal already aborted at
   *  wire-up time (each channel words its own determinate/indeterminate consequence). */
  abortResult: () => R
  /** The ssh program itself failed to spawn (never reached the remote). */
  spawnErrorResult: (program: string, message: string) => R
  /** Classify the child's exit — consulted only when nothing settled earlier. `stderrTail` is
   *  the bounded, control-char-sanitized trailing window of the child's stderr. */
  classifyExit: (code: number | null, stderrTail: string) => R
}

/** Run one ssh exec channel to completion: spawn → (stdin payload) → observe → settle exactly
 *  once → teardown. The child is always torn down at settle (killing an already-exited child
 *  is a no-op), and the abort listener is always removed. */
export async function runSshExecChannel<R>(spec: ExecChannelSpec<R>): Promise<R> {
  return await new Promise<R>((resolvePromise) => {
    const child = spawnSsh(spec.ssh, spec.argv)
    let stderrTail = ''
    let settled = false

    const teardownChild = (): void => {
      try { child.kill() } catch { /* already gone */ }
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }
    const removeAbort = (): void => { spec.signal?.removeEventListener('abort', onAbort) }
    const settle = (r: R): void => {
      if (settled) return
      settled = true
      removeAbort()
      teardownChild()
      resolvePromise(r)
    }
    function onAbort(): void { settle(spec.abortResult()) }
    spec.signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (e) => {
      settle(spec.spawnErrorResult(spec.ssh?.program ?? DEFAULT_SSH_PROGRAM, errText(e)))
    })
    child.stdin.on('error', () => { /* EPIPE from an early-exiting child; the exit path reports */ })
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return
      spec.onStdout?.(chunk, settle)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + sanitizeStderr(chunk.toString('utf8'))).slice(-STDERR_TAIL_CHARS)
    })
    child.on('exit', (code) => {
      if (!settled) settle(spec.classifyExit(code, stderrTail))
    })

    if (spec.signal?.aborted) { onAbort(); return }
    if (spec.stdinPayload !== undefined) child.stdin.write(spec.stdinPayload)
    child.stdin.end()
  })
}
