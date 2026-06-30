import { join } from 'node:path'
import { detectShells } from './pty/shells'
import { writeIntegrationScripts } from './status/integration-scripts'
import { WorkspaceStore } from './persistence/store'
import { QuickStore } from './persistence/quick-store'
import { OrkyRegistryStore } from './persistence/orky-registry-store'
import { userDataDir } from './persistence/paths'
import { Recorder } from './recording/recorder'
import { EnvVault } from './env-vault/env-vault'
import { SearchService } from './search/search-service'
import { OrkyRootEngine } from './orky/orky-root-engine'
import { OrkyRegistry } from './orky/orky-registry'
import type { ShellInfo } from '@shared/types'

export interface Services {
  dir: string
  store: WorkspaceStore
  quick: QuickStore
  shells: ShellInfo[]
  recorder: Recorder
  envVault: EnvVault
  scriptDir: string
  searchService: SearchService
  /** The SHARED app-wide per-root watch/read engine (feature 0005, REQ-014/REQ-020) — constructed ONCE
   *  here and injected into BOTH the pane-chip `OrkyTracker` (`registerOrky`) and the cross-project
   *  `OrkyRegistry`, so a root tracked by N panes + the persisted explicit list still has exactly one
   *  chokidar watcher process-wide. */
  orkyEngine: OrkyRootEngine
  /** The single app-wide cross-project registry aggregator, wrapping `orkyEngine` + its own persisted
   *  `orky-registry.json` store. `init()` is awaited by the composition root (`registerHandlers`) before
   *  the first `registry:status` emit. */
  orkyRegistry: OrkyRegistry
}

/** Build the privileged service layer ONCE for the whole app (not per window). PTYs and stores
 *  are global; windows are just views routed to by the WindowManager. */
export function buildServices(): Services {
  const dir = userDataDir()
  const scriptDir = join(dir, 'shell-integration')
  writeIntegrationScripts(scriptDir)
  const searchService = new SearchService(join(dir, 'search.db'))
  const orkyEngine = new OrkyRootEngine()
  const orkyRegistry = new OrkyRegistry(orkyEngine, new OrkyRegistryStore(dir))
  return {
    dir,
    store: new WorkspaceStore(dir),
    quick: new QuickStore(dir),
    shells: detectShells(),
    recorder: new Recorder(),
    envVault: new EnvVault(dir),
    scriptDir,
    searchService,
    orkyEngine,
    orkyRegistry
  }
}
