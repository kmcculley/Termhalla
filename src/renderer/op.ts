/** Run a fallible user action: await `op`, and on rejection show an error toast (prefixed with
 *  `failMsg`) and return `false` WITHOUT running any success follow-up. Returns `true` on success.
 *  Centralizes "don't report success when the underlying IPC call actually failed" — e.g. a save
 *  must not mark its buffer clean, and a vault op must not toast "added", if the write threw. */
export async function runOp(
  op: () => Promise<unknown> | unknown,
  toast: (text: string, kind: 'error') => void,
  failMsg: string
): Promise<boolean> {
  try {
    await op()
    return true
  } catch (e) {
    toast(`${failMsg}: ${e instanceof Error ? e.message : String(e)}`, 'error')
    return false
  }
}
