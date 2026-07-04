/**
 * Agent CLI argument parsing (REQ-011) — pure, so the exit-2 usage contract is unit-testable
 * without a process. `main.ts` maps `{ ok: false }` to usage-on-stderr + exit code 2.
 */

export type AgentArgs =
  | { ok: true; ptyBackend: 'node-pty' | 'fake' }
  | { ok: false; usage: string }

const USAGE = 'usage: node termhalla-agent.cjs [--pty=node-pty|fake]   (default: --pty=node-pty)'

export const parseAgentArgs = (argv: string[]): AgentArgs => {
  let ptyBackend: 'node-pty' | 'fake' = 'node-pty'
  for (const arg of argv) {
    if (arg.startsWith('--pty=')) {
      const value = arg.slice('--pty='.length)
      if (value !== 'node-pty' && value !== 'fake') {
        return { ok: false, usage: `unknown --pty backend "${value}" — expected node-pty or fake\n${USAGE}` }
      }
      ptyBackend = value
    } else {
      return { ok: false, usage: `unknown argument "${arg}"\n${USAGE}` }
    }
  }
  return { ok: true, ptyBackend }
}
