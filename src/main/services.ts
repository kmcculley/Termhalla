import { join, resolve } from 'node:path'
import { app } from 'electron'
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
import { OrkyActionDispatcher } from './orky/orky-action-dispatcher'
import { OrkyActionAuditLog } from './orky/orky-action-audit'
import { OrkyActionQueue } from './orky/orky-action-queue'
import { verifyOrkyContract } from './orky/orky-contract-handshake'
import { RemoteWorkspaceManager } from './remote/remote-workspace-manager'
import { MANIFEST_VERSION, resolveAgentArtifactPath, resolvePhoneClientStaticRoot, resolvePrebuiltRoot } from './remote/agent-artifact'
import { connectWithProvisioning } from '../remote-client/bootstrap'
import { e2eRemoteOverride } from './e2e-remote'
import { loadNamedAgents } from '../remote-client/agents-store'
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
  /** Termhalla's first write-capable IPC surface into an Orky-adopted project (feature 0007). Wraps
   *  Orky's own `feedback`/`gatekeeper` CLIs — never a direct `.orky/` write (REQ-019), never drives
   *  the pipeline (D1). Reads the SAME `orkyRegistry` instance above for its server-side project-root
   *  allowlist (D3/REQ-004) — no second `OrkyRegistry`. Owned solely by `register-orky-action.ts`;
   *  `register.ts` disposes it once alongside the other single-owner registrars. */
  orkyActionDispatcher: OrkyActionDispatcher
  /** The remote-workspace router (feature 0022): ONE per app, constructed here with the F19
   *  provisioned bootstrap + real timers; its routed `send` arrives later (registerHandlers builds
   *  it) via setRemoteSend. Dispose via disposeRemote (aborts in-flight connects, kills wires). */
  remoteManager: RemoteWorkspaceManager
  /** Late-bind the routed pane-scoped send into the remote manager (composition order: the send
   *  seam is built by registerHandlers AFTER services exist). */
  setRemoteSend(send: (channel: string, ...args: unknown[]) => void): void
  /** The named-agents registry file path (userData — F19 bound no location; F21 wires it here). */
  remoteAgentsPath: string
  disposeRemote(): void
  /** Where the built phone web client (feature 0026) lives — dev/packaged split, mirroring the
   *  agent-artifact resolvers (`resolvePhoneClientStaticRoot`). */
  phoneClientStaticRoot: string
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
  const orkyActionDispatcher = new OrkyActionDispatcher({
    registry: orkyRegistry,
    auditLog: new OrkyActionAuditLog(dir),
    queue: new OrkyActionQueue()
  })
  // Fire-and-forget contract handshake against the installed Orky plugin (log-only observability,
  // never a gate): one warn line at startup if `gatekeeper contract` disagrees with Termhalla's
  // mirrored constants. Cached per located path; tolerates an absent/pre-contract plugin.
  void verifyOrkyContract().catch(() => {})

  // Remote workspaces (feature 0022): ONE manager app-wide. The routed pane-scoped send does not
  // exist yet (registerHandlers builds it), so the manager gets a late-bound forwarder; everything
  // else is real: the F19 provisioned bootstrap (never a re-derived handshake), the ONE manifest
  // version + the dev/packaged artifact path (version-lock, REQ-006), real timers for the ack
  // quiet-flush (CONV-036 — the pure module stays timer-free; the composition root injects the
  // scheduler), and the named-agent registry at userData/remote-agents.json (REQ-004).
  const remoteAgentsPath = join(dir, 'remote-agents.json')
  // The dev app root for the artifact resolvers. NOT `app.getAppPath()`: that is the repo root
  // only when Electron is launched with the app DIRECTORY (`electron .`). Launched by entry file
  // (`electron out/main/index.js` — the e2e harness convention, and how electron-vite dev can
  // launch too) it is `out/main`, and the dev artifact path silently doubles to
  // `out/main/out/agent/...` — a remote connect then fails at provisioning with ENOENT (caught by
  // remote-connected.spec.ts the first time the green path ran in-app). The bundle's own location
  // is authoritative in every launch shape: out/main → the repo root is two levels up. Packaged
  // builds never consult appRoot (they resolve under resourcesPath).
  const devAppRoot = resolve(import.meta.dirname, '..', '..')
  // Feature 0023 (REQ-005/REQ-018): the same dev/packaged split as the agent artifact resolves
  // where the release-time-staged node-pty prebuilts live, so a real connect co-provisions the
  // matching remote target automatically (absent this option, `connectWithProvisioning` behaves
  // exactly as it did before this feature — REQ-018's strictly-additive rule).
  const nodePtyPrebuiltRoot = resolvePrebuiltRoot({
    packaged: app.isPackaged,
    appRoot: devAppRoot,
    resourcesPath: process.resourcesPath
  })
  let remoteSend: (channel: string, ...args: unknown[]) => void = () => {}
  const remoteManager = new RemoteWorkspaceManager({
    send: (channel, ...args) => remoteSend(channel, ...args),
    loadAgents: () => loadNamedAgents(remoteAgentsPath),
    connect: ({ agent, version, artifactPath, signal, workspaceId }) =>
      connectWithProvisioning({
        agent, version, artifactPath, signal,
        // The e2e harness's transport substitution (fake-ssh shim + forced fake backend) — an
        // undefined spread outside the harness, so production connects are untouched. Gated
        // through e2e-remote.ts exactly like window presentation (never read the env var here).
        ...e2eRemoteOverride(),
        nodePty: { prebuiltRoot: nodePtyPrebuiltRoot },
        // Feature 0024-agent-daemonization (REQ-013/REQ-018, locked D6′): production connects opt
        // into the daemon flow with the workspace id as the scope — a PER-WORKSPACE persistent
        // unix-domain-socket daemon survives the client closing/reopening (making the SHIPPED F18
        // inventory/replay reattach path work across a real disconnect), and two same-host
        // workspaces stay fully independent (each gets its own daemon/socket/lease). The manager
        // always supplies `workspaceId` (its type is loose only for the frozen test harness).
        daemon: { workspaceId: workspaceId ?? '' }
      }),
    version: MANIFEST_VERSION,
    artifactPath: resolveAgentArtifactPath({
      packaged: app.isPackaged,
      appRoot: devAppRoot,
      resourcesPath: process.resourcesPath
    }),
    scheduler: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) }
  })

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
    orkyRegistry,
    orkyActionDispatcher,
    remoteManager,
    setRemoteSend: (send) => { remoteSend = send },
    remoteAgentsPath,
    disposeRemote: () => remoteManager.stop(),
    phoneClientStaticRoot: resolvePhoneClientStaticRoot({
      packaged: app.isPackaged,
      appRoot: devAppRoot,
      resourcesPath: process.resourcesPath
    })
  }
}
