/** A discovered shell the user can launch. */
export interface ShellInfo {
  id: string          // stable id: 'pwsh' | 'powershell' | 'cmd' | 'gitbash' | ...
  label: string       // human label, e.g. 'PowerShell 7'
  path: string        // absolute path to executable
  args: string[]      // launch args
}

export type TermState = 'idle' | 'busy' | 'needs-input'

export interface TerminalStatus {
  state: TermState
  lastExit?: 'success' | 'failure'
  since: number
}

// ── Orky status awareness (feature 0004) — live runtime wire types (NOT persisted; no SCHEMA bump).
/** The canonical Orky pipeline phases, in order. `human-review` is the final real gate. The single
 *  source of truth for the literal list is `ORKY_PHASES` in `@shared/orky-status`; this type mirrors it. */
export type OrkyPhase = 'brainstorm' | 'spec' | 'plan' | 'tests' | 'implement' | 'review' | 'doc-sync' | 'human-review'

/** The Orky run's kind, mapped onto the terminal-status model (+ `done`/`cleared`). */
export type OrkyKind = 'busy' | 'idle' | 'needs-input' | 'done' | 'cleared'

/** Structured needs-you discriminator the chip selector ranks on (escalation > stalled > human-review). */
export type OrkyReason = 'escalation' | 'stalled' | 'human-review' | null

/** One feature's rolled-up Orky status (the unit the selector ranks + the popover lists). */
export interface OrkyFeatureStatus {
  feature: string            // slug / id
  kind: OrkyKind
  phase: OrkyPhase | null    // current phase
  gateN: number              // gates passed
  gateM: number              // total gates (= ORKY_PHASES.length)
  openBlocking: number       // open CRITICAL/HIGH or contract-violation findings
  needsHuman: boolean
  failed: boolean            // a halted gate failure (drives lastExit:'failure' styling)
  reason: OrkyReason         // why it needs a human (null when needsHuman is false)
  lastActivityAt: number
  detail: string             // human-readable, actionable
}

/** The per-pane Orky roll-up emitted over `orky:status`. `null` over the wire = cleared. */
export interface OrkyPaneStatus {
  kind: OrkyKind                  // the chip-feature's kind
  label: string                  // `feature · phase · gate N/M · ●k open`
  needsHuman: boolean
  failed: boolean
  features: OrkyFeatureStatus[]   // ALL non-Idle features, ranked, for the popover
  chipFeature: string | null      // selectChipFeature result; null when no features
}

// ── Orky OSC heartbeat (feature 0014) — a SECOND source of OrkyPaneStatus, via a stream-parsed PTY
// marker (the OSC marker CONTRACT lives in src/main/status/orky-osc-parser.ts / docs/features/
// orky-osc-heartbeat.md). Declared here (not in src/main/status/orky-osc-parser.ts) so this
// Electron-free shared module can reference it without a main->shared->main import cycle; the
// parser module re-exports it for its documented public-interface surface.
//
// Wire shape per Orky ADR-026 (the REAL, shipped contract — supersedes this feature's earlier
// placeholder OSC 8888/key=value grammar): `\x1b]9999;<single-line compact JSON>BEL`. The JSON
// payload does NOT carry `kind`/`openBlocking`/`failed` the way the old key=value grammar did —
// those are Termhalla-side derivations/defaults computed in `src/shared/orky-status.ts`'s
// `heartbeatToFeatureStatus` (REQ-009), never read off the wire. `action` is new (the app-loop
// liveness field, carried only when no feature is resolvable).
/** A single decoded, validated heartbeat — the strict-but-tolerant JSON-decode result of one ADR-026
 *  OSC marker payload (`src/main/status/orky-osc-parser.ts`'s `decodeHeartbeat`). Field mapping is
 *  direct/verbatim from the payload (thin client, REQ-004) — Termhalla never re-derives `drive()`
 *  semantics from these bytes. */
export interface OrkyHeartbeat {
  feature: string | null           // payload.feature; null for an app-loop tick (REQ-011)
  phase: OrkyPhase | string | null // payload.phase, verbatim; null only affects the chip LABEL fallback ('done'), never the kind derivation (gate-based only, see heartbeatKind / REQ-009)
  gateN: number                    // parsed from payload.gate "<N>/<M>"
  gateM: number                    // parsed from payload.gate; default ORKY_PHASES.length
  needsHuman: boolean              // payload.needsHuman === true
  reason: string | null            // payload.reason verbatim (free-form prose), null when absent
  action: string | null            // payload.action (only meaningful when feature is null)
}

// ── Cross-project Orky registry (feature 0005) — live runtime wire types (NOT persisted beyond the
// roots list itself; see orky-registry.json / REQ-013 — no SCHEMA_VERSION bump).
/** Why a root is a member of the cross-project aggregate. `both` = an open pane resolves to it AND it
 *  is in the persisted explicit list. */
export type OrkyRootSource = 'pane' | 'persisted' | 'both'

/** One project's entry in the cross-project aggregate (D3: reuse `OrkyPaneStatus` per resolved root —
 *  no parallel status type is invented). The index signature is a type-only convenience (erased at
 *  runtime, doesn't add properties) so test code can structurally cast a snapshot to
 *  `Record<string, unknown>[]` for a generic `Object.keys()` shape assertion. */
export interface OrkyRegistryEntry {
  root: string                    // resolved project root (the dir CONTAINING .orky/), absolute, normalized
  source: OrkyRootSource          // membership provenance
  status: OrkyPaneStatus | null   // the reused 0004 roll-up for this root; null = not yet read / unreadable
  [key: string]: unknown
}

/** The cross-project aggregate emitted over `registry:status`. Sorted by `root` (codepoint) — REQ-007. */
export type OrkyRegistrySnapshot = OrkyRegistryEntry[]

/** Result of an add/remove-root IPC call (CONV-001: specific, actionable error on failure). */
export interface RegistryMutationResult {
  ok: boolean
  root?: string        // the normalized root, on success
  roots: string[]      // the persisted list AFTER the mutation (normalized, sorted)
  error?: string        // specific + actionable when ok === false (CONV-001)
}

// ── Native OrkyPane per-root detail (feature 0009) — the `registry:detail` wire types (REQ-007).
// Read-only, runtime-only (not persisted); derived main-side from the SAME @shared/orky-status
// mapper pipeline the aggregate uses, PLUS the detail layers the aggregate drops (per-gate
// records, findings entries, escalation entries). Every field is total over malformed input: a
// missing/mistyped source field maps to its pinned null/''/false default, never a throw, and never
// a mistyped value passed through to be rendered.

/** One canonical gate's recorded outcome (null fields = not recorded). */
export interface OrkyGateDetail {
  phase: OrkyPhase               // one of ORKY_PHASES, emitted in canonical order
  passed: boolean | null         // gates[phase].passed === true/false; null = no entry yet
  at: number | null              // parseOrkyTimestamp(gates[phase].at) — epoch ms, tz-safe
  evidence: string | null        // gates[phase].evidence when a string
  external: boolean              // gates[phase].external === true (human-recorded)
}

export interface OrkyFindingDetail {
  id: string | null              // f.id when a non-empty string
  lens: string | null
  severity: string | null        // verbatim (producer-normalized; display uppercases nothing)
  status: string | null          // verbatim ('open' / 'resolved' / …)
  gate: string | null
  claim: string                  // verbatim; '' when absent/mistyped (never rendered mistyped)
  blocking: boolean              // the SHARED isBlockingFinding(f) verdict (@shared/orky-status)
  // v2 `finding_resolution` fields (feature 0015-orky-contract-v2-refresh, REQ-109) — additive,
  // derived runtime display data riding the EXISTING `registry:detail` payload; no persistence.
  resolution: string | null      // f.resolution when a string, verbatim (no trimming), else null
  resolvedBy: string | null      // f.resolvedBy when a string, verbatim, else null
  resolvedAt: number | null      // parseOrkyTimestamp(f.resolvedAt) — epoch ms, tz-safe; string-only
}

export interface OrkyEscalationDetail {
  id: string | null
  phase: string | null
  status: string | null          // 'open' / 'resolved', verbatim
  reason: string                 // '' when absent
  kind: string | null
  at: number | null              // parseOrkyTimestamp(e.at)
  decision: string | null
  resolvedAt: number | null
}

export interface OrkyFeatureDetail {
  slug: string                   // the feature DIR name from the sorted walk — UNIQUE by construction
                                 // (FINDING-021: status.feature is state.json's `feature` field with the
                                 // '(unknown)' fallback and can collide; slug is the per-feature KEY for
                                 // React rows, disclosure state, and data-feature — REQ-007/REQ-012)
  status: OrkyFeatureStatus      // the SAME orkyFeatureStatus mapper output the aggregate uses
  gates: OrkyGateDetail[]        // exactly ORKY_PHASES.length entries, canonical order
  findings: OrkyFindingDetail[]  // findings.json array order, verbatim
  findingsUnreadable: boolean    // findings.json EXISTS but stayed unreadable/oversized after the bounded retry (REQ-008)
  escalations: OrkyEscalationDetail[] // state.json array order, verbatim
}

export type OrkyRootDetailResult =
  | { ok: true; root: string; activeFeature: string | null;
      computedAt: number;                 // the ONE injected clock instant every status/stall datum in this payload used (REQ-007/REQ-009)
      features: OrkyFeatureDetail[];      // sorted by status.feature codepoint, slug codepoint tiebreak (TOTAL — REQ-014)
      skippedFeatures: string[];          // slugs whose state.json EXISTS but stayed unreadable/oversized after the bounded retry — never silently dropped (REQ-008)
      featuresCapped: boolean }           // true iff the MAX_FEATURE_DIRS cap truncated the SORTED walk (CONV-003)
  | { ok: false; root: string; error: string;                      // specific + actionable (CONV-001)
      errorKind: 'root-not-tracked' | 'orky-missing' | 'unknown-sender' }

export interface AlertConfig {
  border?: boolean
  tabBadge?: boolean
  osNotification?: boolean
  needsInput?: boolean
}

export interface TerminalLaunch {
  command: string
  args: string[]
  title: string
}

/** Common tmux options, applied via server-global `set -g` on connect (only when tmuxSession is
 *  set). An undefined field uses its default: mouse/trueColor/fastEsc ON, clipboard OFF, no
 *  history-limit. `set -g` overrides the remote ~/.tmux.conf. */
export interface TmuxOptions {
  mouse?: boolean        // default true  -> set -g mouse on
  trueColor?: boolean    // default true  -> default-terminal tmux-256color + terminal-overrides *:Tc
  fastEsc?: boolean      // default true  -> set -g escape-time 10
  historyLimit?: number  // default unset -> omit; when > 0 -> set -g history-limit N
  clipboard?: boolean    // default false -> set -g set-clipboard on
}

/** A saved SSH connection. No secrets stored — only host/user/port and an identity-file path. */
export interface SshConnection {
  id: string
  name: string
  host: string
  user: string
  port?: number          // default 22
  identityFile?: string  // path to a private key; optional
  tmuxSession?: string   // when set (non-empty), connect via `tmux new -A -s <name>`
  tmuxOptions?: TmuxOptions // tmux `set -g` options applied on connect (only with tmuxSession)
}

export interface WorkspaceTemplate {
  id: string
  name: string
  layout: MosaicNode | null
  panes: Record<string, PaneNode>
  theme?: Partial<Theme>
  runCommands?: RunCommand[]   // workspace-scoped saved run commands
  // Per-workspace home (feature 0022): carried so a template saved from a remote workspace
  // re-instantiates remote. Normalized through normalizeWorkspaceHome at instantiation
  // (workspaceFromTemplate — the CONV-026 hostile-template seam), like every persisted home.
  home?: import('./remote-home').WorkspaceHome
}

export interface Theme {
  windowBg: string
  panelBg: string
  elevatedBg: string
  border: string
  text: string
  textDim: string
  accent: string
  statusBusy: string
  statusNeedsInput: string
  fontFamily: string
  fontSize: number
  termBg: string
  termFg: string
  termFontFamily: string
  termFontSize: number
}

/** Terminal scrollback lines when `quick.termScrollback` is unset (QoL 2026-07-17 — the xterm
 *  default of 1000 silently lost long build output). */
export const DEFAULT_TERM_SCROLLBACK = 5000

/** App-global favorites/recents (persisted to quick.json, not per-workspace). */
export interface QuickStore {
  connections: SshConnection[]
  recentConnections: string[]   // connection ids, most-recently-used
  favoriteDirs: string[]        // user-pinned (★)
  recentDirs: string[]          // MRU, deduped, capped, home excluded
  templates: WorkspaceTemplate[]
  theme?: Partial<Theme>
  themePresets: { id: string; name: string; theme: Theme }[]
  recordByDefault?: boolean
  autoResumeClaude?: boolean     // re-run `claude --resume` in restored terminals that had Claude (default on)
  copyOnSelect?: boolean         // copy a terminal selection to the clipboard as soon as it's made (default on)
  cleanCopy?: boolean            // normalize copied terminal text (reflow TUI-wrapped lines, trim/collapse blanks) before it hits the clipboard (default on)
  toastsEnabled?: boolean        // show bottom-right toast notifications; toasts render only when strictly true (default off)
  termScrollback?: number        // terminal scrollback lines (QoL 2026-07-17); absent => DEFAULT_TERM_SCROLLBACK
  editorWordWrap?: boolean       // Monaco word wrap (QoL 2026-07-17); default off
  editorMinimap?: boolean        // Monaco minimap (QoL 2026-07-17); default off
  themeFollowSystem?: boolean    // apply built-in Light/Dark to match the OS (QoL 2026-07-17); default off
  orkyNeedsYouNotifications?: boolean   // app-wide OS notifications when an Orky project needs a decision (feature 0013); default ENABLED — absent ⇒ !== false ⇒ on
  keybindings?: Record<string, string>   // CommandId -> chordKey ("mod+shift+t") | 'none' (unbound)
  phoneRemote?: import('./phone-remote/settings').PhoneRemoteSettings   // additive optional (feature 0026); no SCHEMA_VERSION bump — tokenHash only, never the plaintext token
}

export const EMPTY_QUICK: QuickStore = {
  connections: [], recentConnections: [], favoriteDirs: [], recentDirs: [], templates: [], themePresets: []
}

/** Per-terminal pane configuration (what gets serialized). */
export interface TerminalConfig {
  kind: 'terminal'
  shellId: string
  cwd: string
  name?: string
  alerts?: AlertConfig
  launch?: TerminalLaunch   // when set, run this instead of a discovered shell (SSH)
  connectionId?: string     // links back to the saved SshConnection, for display
  envId?: string            // links to a per-terminal env-vault entry; injected on spawn
  theme?: Partial<Theme>
  runCommands?: RunCommand[]   // pane-scoped saved run commands
  historyMuted?: boolean        // absent = indexed
  resumeAi?: AiTool             // an AI tool (e.g. claude) was running at last save; auto-resume on restore
}

export interface EditorConfig {
  kind: 'editor'
  files: string[]
  activePath?: string
  name?: string
  theme?: Partial<Theme>
}

export interface ExplorerConfig {
  kind: 'explorer'
  root: string
  name?: string
  theme?: Partial<Theme>
}

/** Persisted config of a native Orky pane (feature 0009, REQ-001/REQ-005): a first-class mosaic
 *  pane kind bound to ONE tracked project. `root` is the persisted binding (the dir containing
 *  `.orky/`), stored VERBATIM in the aggregate's case-preserved spelling — never re-cased,
 *  re-slashed, or re-resolved on save/load; matching against membership uses the fold-injected
 *  `sameProjectRoot` equality instead. `''` is the tolerated unbound-on-load degenerate value
 *  (REQ-020) — never written by the creation flow. */
export interface OrkyConfig {
  kind: 'orky'
  root: string
  name?: string
  theme?: Partial<Theme>
}

/** A persisted unsaved editor buffer (hot-exit). Keyed by `paneId::path` in the draft store. */
export interface EditorDraft {
  content: string    // the unsaved buffer text to restore
  baseline: string   // the disk text the buffer diverged from (for on-reopen conflict detection)
}

export type PaneConfig = TerminalConfig | EditorConfig | ExplorerConfig | OrkyConfig

export interface PaneNode {
  paneId: string
  config: PaneConfig
}

/** react-mosaic layout tree. Leaves are paneIds (strings). */
export type MosaicDirection = 'row' | 'column'
export interface MosaicParent {
  direction: MosaicDirection
  first: MosaicNode
  second: MosaicNode
  splitPercentage?: number
}
export type MosaicNode = string | MosaicParent

/** The four UI split directions a pane's compass control offers. Maps to orientation × insertion
 *  position via `splitDirToLayout` (workspace-model.ts): right→{row,after}, down→{column,after},
 *  left→{row,before}, up→{column,before}. */
export type SplitDir4 = 'up' | 'down' | 'left' | 'right'

export interface Workspace {
  id: string
  name: string
  layout: MosaicNode | null         // null = no panes yet
  panes: Record<string, PaneNode>   // paneId -> pane
  theme?: Partial<Theme>
  runCommands?: RunCommand[]   // workspace-scoped saved run commands (shown on every terminal)
  // Persisted pane view-state (SCHEMA_VERSION 7+). Holds ONLY pane id references / flags — never
  // scrollback, output, or secrets (see no-secrets posture). `minimized` lists the panes hidden
  // off-layout (still alive, restorable from the tray); `maximized` is the pane filling the body
  // (null = none). Both are derived into the renderer store's per-ws maps on load and folded back
  // onto the record on save (applyViewState) — never written to app-state from the renderer.
  minimized?: string[]
  maximized?: string | null
  // Per-workspace home (feature 0022, SCHEMA_VERSION 9, locked decision 7): ABSENT = local (the
  // byte-identical default); { kind: 'agent', agentId, agentName } homes every pane in this
  // workspace to that named agent over ONE connection. Config only — never a secret (the
  // named-agent registry itself holds at most an identity-file PATH).
  home?: import('./remote-home').WorkspaceHome
}

/** One OS window: which workspaces it hosts (tab order), its active tab, and its bounds. */
export interface WindowLayout {
  workspaceIds: string[]
  activeId: string | null
  bounds: WindowState
  isMain: boolean        // exactly one window is the main/root window
}

export interface AppState {
  schemaVersion: number
  windows: WindowLayout[]   // windows[0] is the main window
}

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

export interface DirEntry { name: string; path: string; isDir: boolean }
/** Discriminated fsRead result (2026-07 quality audit, finding 27). Failures are classified
 *  structurally in main (by `err.code`) instead of the renderer regexing an IPC-serialized
 *  error message: only a real not-found may render a tab as "(deleted)"; every other failure
 *  (permissions, transient I/O, …) is a distinct 'error' the UI must not misreport. */
export type ReadResult =
  | { kind: 'ok'; content: string; tooLarge: boolean }
  | { kind: 'binary' }                  // exists but has NUL bytes — can't display
  | { kind: 'not-found' }               // ENOENT/ENOTDIR — the path really isn't there
  | { kind: 'error'; message: string }  // unknown failure — the file may well exist
export interface StatResult { size: number; mtimeMs: number; isDir: boolean }
export type FsEvent = 'add' | 'unlink' | 'change' | 'addDir' | 'unlinkDir'
export interface FsChange { event: FsEvent; path: string }

/** One process in a terminal's descendant tree. `depth` = 0 for direct children of the shell. */
export interface ProcNode {
  pid: number
  ppid: number
  name: string      // image name without ".exe", e.g. "node"
  command: string   // full CommandLine, or the name when CommandLine is empty
  depth: number
}

/** Foreground process + descendant tree for one terminal. */
export interface ProcInfo {
  foreground: string   // leaf process name shown on the chip when busy
  tree: ProcNode[]     // DFS pre-order; render indented by `depth`
}

/** Live git status for a pane's repo root. Runtime-only (not persisted). `branch` holds the
 *  short commit sha when `detached` is true. `dirty` = staged + unstaged + conflicted +
 *  untracked > 0. */
export interface GitStatus {
  root: string
  branch: string
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  unstaged: number
  /** Porcelain-v2 unmerged (`u`) entries — a mid-merge conflict is its own category, neither
   *  staged nor unstaged (baseline KNOWN BUG #3, fixed 2026-07-09). */
  conflicted: number
  untracked: number
  dirty: boolean
}

/** The AI coding agents Termhalla can recognize running in a terminal. */
export type AiTool = 'claude' | 'codex'

/** A detected AI coding-agent session running in a terminal. */
export interface AiSession {
  tool: AiTool
  label: string   // 'Claude' | 'Codex'
}

/** Recording lifecycle for one terminal, pushed on rec:state. */
export interface RecState { recording: boolean; file: string | null }

/** Env-vault availability/unlock status, pushed on env:state. */
export interface EnvVaultState { exists: boolean; unlocked: boolean }

export type CloudState = 'checking' | 'logged-in' | 'logged-out' | 'not-installed' | 'error'

/** Global login status for one cloud provider (AWS/Azure). Runtime-only, never persisted. */
export interface CloudStatus {
  id: string
  label: string
  state: CloudState
  account?: string                    // short identity (account id / subscription name)
  detail?: Record<string, string>     // popover rows
  checkedAt: number
  login?: TerminalLaunch              // command for the "Log in" button (reuses the launch shape)
  family?: string                     // provider family: 'aws' | 'azure'
  profile?: string                    // AWS profile name (aws members only)
}

/** Live usage metrics for a Claude session, parsed from its transcript. */
export interface UsageMetrics {
  input: number          // cumulative non-cached input tokens
  output: number         // cumulative output tokens
  cacheRead: number      // cumulative cache-read tokens
  cacheCreation: number  // cumulative cache-creation tokens
  contextTokens: number  // current context size (last assistant turn's input-side total)
  contextWindow: number  // the model's context window (e.g. 200000)
  contextPct: number     // round(contextTokens / contextWindow * 100)
}

/** Decrypted env-vault contents surfaced to the renderer while unlocked. */
export interface EnvVaultData { global: Record<string, string>; terminals: Record<string, Record<string, string>> }

export interface SearchHit {
  id: number
  paneId: string
  ts: number
  cwd: string
  snippet: string
}
export interface SearchStats {
  segments: number
  oldest: number | null
}

// v7 → v8 (feature 0009): the persisted `orky` pane kind joined PaneConfig. The v<8 migration step
// is a documented identity (workspace-model.ts); the bump exists so pre-v8 builds reject a v8 file
// via the "newer than supported" guard instead of loading a pane kind they cannot render (REQ-002).
// v8 → v9 (feature 0022): the persisted per-workspace `home` joined the Workspace record. The v<9
// migration step is likewise a documented identity (a pre-v9 record cannot carry a home); the bump
// exists so a pre-v9 build rejects a v9 file via the "newer than supported" guard instead of
// silently DROPPING the home and spawning panes meant for a remote machine as local shells.
export const SCHEMA_VERSION = 9

/** A saved, named command a user can run on click in a terminal. Persisted (pane- or
 *  workspace-scoped). Runtime sending reuses encodeBroadcast(command, 'keys', true). */
export interface RunCommand {
  id: string
  label: string
  command: string
}

// ── Orky action-dispatch (feature 0007) — Termhalla's first write-capable IPC surface into an
// Orky-adopted project. Every mutation is performed by invoking Orky's OWN CLIs (`feedback emit`,
// `gatekeeper resolve-escalation`, `gatekeeper record`); this feature never writes a file under any
// `.orky/` tree itself, never spawns an agent, and never drives the pipeline (D1). Runtime-only wire
// types — no SCHEMA_VERSION bump (the audit log is a plain JSONL file, not part of the migration chain).

/** Which Orky CLI actually performed the action. `null` when the request was rejected before any CLI ran. */
export type OrkyActionPath = 'feedback' | 'gatekeeper' | null

/** Ground-truth feedback-channel state for a feedback-routed action, derived from the emit's `mode`
 *  (`'noop'` ⇒ `'disabled'`). Distinguishes "not enabled for this project" from "enabled but the CLI
 *  failed" (CONV-001) — the distinction D2/CONV-001 require F8's UI to be able to show. */
export type OrkyFeedbackState = 'enabled' | 'disabled'

/** Machine-routable rejection/failure discriminator (CONV-001: paired with a specific `error` string). */
export type OrkyActionErrorKind =
  | 'unknown-sender'      // sender not a known app window (REQ-003)
  | 'invalid-args'        // missing/ill-typed/malformed argument (REQ-014)
  | 'root-not-allowed'    // projectRoot not in registry.roots() (D3, REQ-004)
  | 'gate-not-allowed'    // recordHumanGate gate outside {brainstorm, human-review} (REQ-008)
  | 'feature-not-found'   // feature slug does not resolve to a feature dir under the root (REQ-005)
  | 'feedback-disabled'   // submitWork with no live control plane and no fallback (REQ-007)
  | 'orky-cli-not-found'  // the Orky CLI could not be located (REQ-012)
  | 'cli-timeout'         // the CLI child exceeded the timeout / was aborted (REQ-010/REQ-011)
  | 'cli-error'           // the CLI threw / exited with an error code (exit 2), OR (ESC-006) a
                          // feedback emit that exited 0 but whose own parsed stdout reports
                          // {ok:false} — an in-band internal error, not a disabled channel
                          // (REQ-006/REQ-007/REQ-011)
  | 'cli-unparseable'     // the CLI stdout was not the expected JSON object (REQ-011)

/** The uniform result of every action (CONV-001: `ok:false` always carries `errorKind` + a specific
 *  `error`). `data` is the parsed CLI JSON object on success (escalation obj / gate obj / drive next-action /
 *  feedback emit result). */
export interface OrkyActionResult {
  ok: boolean
  path: OrkyActionPath                 // which CLI ran (null if rejected pre-CLI)
  dispatched: boolean                  // did the human input land durably? (false for driveStatus reads and
                                       //   for a feedback-disabled submitWork — never a silent success)
  feedback?: OrkyFeedbackState         // present for feedback-capable actions (resolveEscalation/submitWork)
  exitCode?: number | null             // the CLI process exit code (null on timeout/abort/spawn failure)
  data?: unknown                       // parsed CLI stdout JSON on success
  error?: string                       // specific + actionable (CONV-001) when ok === false
  errorKind?: OrkyActionErrorKind      // set iff ok === false
}

export interface ResolveEscalationRequest {
  projectRoot: string                  // the allowlisted target project root (dir containing .orky/)
  feature: string                      // feature slug (single path segment under <root>/.orky/features/)
  escalationId: string                 // e.g. "ESC-001"
  decision: string                     // the human's decision text
}
export interface SubmitWorkRequest {
  projectRoot: string
  feature?: string                     // optional: a feature-scoped work item; omit for project-level
  title: string                        // required, non-empty
  detail?: string                      // optional longer body
  phase?: string                       // optional originating phase
}
export interface RecordHumanGateRequest {
  projectRoot: string
  feature: string
  gate: 'brainstorm' | 'human-review'  // server-restricted (REQ-008); any other value → gate-not-allowed
  verdict: 'pass' | 'fail'
  evidence?: string
}
export interface DriveStatusRequest {
  projectRoot: string
  feature: string
}

export type ScheduleTrigger =
  | { kind: 'delay'; ms: number }
  | { kind: 'idle' }
  | { kind: 'recurring'; everyMs: number; jitterMs: number }

export interface ScheduledTask {
  id: string
  paneId: string
  text: string
  mode: 'paste' | 'keys'
  enter: boolean
  trigger: ScheduleTrigger
  label: string
}
