/**
 * How the e2e harness substitutes the remote-agent transport.
 *
 * A Playwright spec cannot reach a real ssh host, and the native pty backend has no Windows
 * target — yet the CONNECTED remote-workspace surface (banner, capability gates, live pane
 * round-trips, daemon reattach) is exactly what only an in-app run can exercise. The vitest
 * integration suites already solved the transport half with `tests/fixtures/fake-ssh.mjs`: a
 * stand-in for the system `ssh` binary that runs the REAL agent/bridge/daemon as local child
 * processes against an env-configured fake remote home (`FAKE_SSH_HOME`), over the identical
 * protocol path production runs over ssh.
 *
 * `TERMHALLA_E2E_REMOTE_SSH` carries that substitution into the app: a JSON
 * `{ program, prefixArgs }` (the harness's own node + the shim path) that `services.ts` spreads
 * into `connectWithProvisioning` as the existing `ssh` program-override seam, plus a FORCED
 * `ptyBackend: 'fake'` — the harness may never launch the native backend (Linux-only, no local
 * prebuilt; the failure mode would be a silent hang, not a red assertion).
 *
 * Set only by the remote e2e specs. Unset — the product default — this returns `undefined` and
 * the connect options are byte-identical to production; nothing here can change how the shipped
 * app behaves. A structural test (tests/main/e2e-remote.test.ts) pins this file as the ONLY
 * reader of the env var, mirroring the e2e-presentation.ts discipline.
 */

export interface E2eRemoteOverride {
  ssh: { program: string; prefixArgs: string[] }
  ptyBackend: 'fake'
}

/** Pure given its argument; defaults to reading the harness env at call time. Any malformed
 *  value degrades to `undefined` (production behavior) — never a throw, never a partial. */
export function e2eRemoteOverride(
  raw: string | undefined = process.env.TERMHALLA_E2E_REMOTE_SSH
): E2eRemoteOverride | undefined {
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const program = (parsed as { program?: unknown }).program
  if (typeof program !== 'string' || program === '') return undefined
  const rawArgs = (parsed as { prefixArgs?: unknown }).prefixArgs
  const prefixArgs = Array.isArray(rawArgs) && rawArgs.every((a) => typeof a === 'string')
    ? (rawArgs as string[])
    : []
  return { ssh: { program, prefixArgs }, ptyBackend: 'fake' }
}
