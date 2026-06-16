import { join } from 'node:path'
import { detectShells } from './pty/shells'
import { writeIntegrationScripts } from './status/integration-scripts'
import { WorkspaceStore } from './persistence/store'
import { QuickStore } from './persistence/quick-store'
import { userDataDir } from './persistence/paths'
import { Recorder } from './recording/recorder'
import { EnvVault } from './env-vault/env-vault'
import type { ShellInfo } from '@shared/types'

export interface Services {
  dir: string
  store: WorkspaceStore
  quick: QuickStore
  shells: ShellInfo[]
  recorder: Recorder
  envVault: EnvVault
  scriptDir: string
}

/** Build the privileged service layer ONCE for the whole app (not per window). PTYs and stores
 *  are global; windows are just views routed to by the WindowManager. */
export function buildServices(): Services {
  const dir = userDataDir()
  const scriptDir = join(dir, 'shell-integration')
  writeIntegrationScripts(scriptDir)
  return {
    dir,
    store: new WorkspaceStore(dir),
    quick: new QuickStore(dir),
    shells: detectShells(),
    recorder: new Recorder(),
    envVault: new EnvVault(dir),
    scriptDir
  }
}
