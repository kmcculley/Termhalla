/** Robust clipboard write for Windows' single global clipboard.
 *
 *  The Windows clipboard is one process-wide lock. Clipboard *redirectors* — RDP / VMware Horizon
 *  clipboard sync, PowerToys AdvancedPaste, Phone Link cross-device clipboard — register as format
 *  listeners and call `OpenClipboard()` to read the new content the instant it changes. While one of
 *  them holds the lock, another app's write loses the race, and Electron's `clipboard.writeText`
 *  reports nothing: it just silently no-ops. That is the root of "copy sometimes works, sometimes
 *  doesn't" on machines running those tools.
 *
 *  We make the write self-verifying: write, read back, and if it didn't stick, wait a beat (the
 *  redirector's read is brief) and retry with a small backoff. Kept dependency-injected (clipboard +
 *  sleep) so it is unit-testable without Electron — the repo convention of a pure-ish module beside
 *  the impure shell. */

export interface ClipboardLike {
  writeText(text: string): void
  readText(): string
}

export interface ReliableWriteOptions {
  /** Total write attempts before giving up (default 6). */
  attempts?: number
  /** Base backoff between attempts in ms; grows linearly per attempt (default 15). */
  delayMs?: number
}

/** Write `text` to the clipboard and confirm it landed, retrying through transient lock contention.
 *  Resolves `true` once a read-back matches `text`, or `false` if every attempt failed (the caller
 *  can log; there is nothing else to do — the clipboard is held by another process). */
export async function writeTextReliably(
  clip: ClipboardLike,
  text: string,
  sleep: (ms: number) => Promise<void>,
  opts: ReliableWriteOptions = {}
): Promise<boolean> {
  const attempts = Math.max(1, opts.attempts ?? 6)
  const delayMs = opts.delayMs ?? 15
  for (let i = 0; i < attempts; i++) {
    // Both calls can throw if OpenClipboard fails outright (rare; usually it silently no-ops).
    try { clip.writeText(text) } catch { /* locked — retry */ }
    try { if (clip.readText() === text) return true } catch { /* locked — retry */ }
    if (i < attempts - 1) await sleep(delayMs * (i + 1))
  }
  return false
}
