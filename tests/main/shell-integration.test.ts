import { describe, it, expect } from 'vitest'
import { shellInjection, PS_SCRIPT, SH_SCRIPT, CMD_PROMPT } from '../../src/main/status/shell-integration'
import { POWERSHELL_INTEGRATION, BASH_INTEGRATION } from '../../src/main/status/integration-scripts'
import { CwdParser } from '../../src/main/status/cwd-parser'
import type { ShellInfo } from '@shared/types'

/** Expand the cmd PROMPT codes the way cmd.exe does at runtime, for a given cwd. */
const expandCmdPrompt = (prompt: string, cwd: string): string =>
  prompt.split('$E').join('\x1b').split('$P').join(cwd).split('$G').join('>')

const shell = (id: string, args: string[] = []): ShellInfo =>
  ({ id, label: id, path: `C:\\${id}.exe`, args })

describe('shellInjection', () => {
  it('injects a dot-source command for PowerShell variants', () => {
    for (const id of ['pwsh', 'powershell']) {
      const inj = shellInjection(shell(id), 'C:\\scripts')!
      expect(inj).not.toBeNull()
      expect(inj.args).toContain('-NoExit')
      expect(inj.args.join(' ')).toContain(PS_SCRIPT)
    }
  })
  it('injects an rcfile for bash variants', () => {
    for (const id of ['gitbash', 'wsl']) {
      const inj = shellInjection(shell(id, ['--login', '-i']), '/scripts')!
      expect(inj).not.toBeNull()
      expect(inj.args).toContain('--rcfile')
      expect(inj.args.join(' ')).toContain(SH_SCRIPT)
    }
  })
  it('injects a cwd-reporting PROMPT for cmd', () => {
    const inj = shellInjection(shell('cmd'), 'C:\\scripts')!
    expect(inj).not.toBeNull()
    expect(inj.env.PROMPT).toBe(CMD_PROMPT)
    // No script file / args swap — cmd reports cwd purely via the PROMPT env var.
    expect(inj.args).toEqual([])
  })
  it('cmd PROMPT expands to a parseable OSC 9;9 cwd report', () => {
    const inj = shellInjection(shell('cmd'), 'C:\\scripts')!
    const emitted = expandCmdPrompt(inj.env.PROMPT, 'C:\\dev\\Termhalla')
    expect(new CwdParser().push(emitted)).toBe('C:\\dev\\Termhalla')
  })
})

describe('integration scripts emit a cwd report', () => {
  it('PowerShell emits OSC 9;9 with the provider path', () => {
    expect(POWERSHELL_INTEGRATION).toContain(']9;9;')
    expect(POWERSHELL_INTEGRATION).toContain('ProviderPath')
  })
  it('bash emits OSC 7 file URL', () => {
    expect(BASH_INTEGRATION).toContain(']7;file://')
  })
})
