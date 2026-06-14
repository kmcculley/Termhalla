import { describe, it, expect } from 'vitest'
import { shellInjection, PS_SCRIPT, SH_SCRIPT } from '../../src/main/status/shell-integration'
import type { ShellInfo } from '@shared/types'

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
  it('returns null for cmd (heuristics only)', () => {
    expect(shellInjection(shell('cmd'), 'C:\\scripts')).toBeNull()
  })
})
