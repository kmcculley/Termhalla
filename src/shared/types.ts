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
  toastsEnabled?: boolean        // show bottom-right toast notifications; toasts render only when strictly true (default off)
  keybindings?: Record<string, string>   // CommandId -> chordKey ("mod+shift+t") | 'none' (unbound)
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

/** A persisted unsaved editor buffer (hot-exit). Keyed by `paneId::path` in the draft store. */
export interface EditorDraft {
  content: string    // the unsaved buffer text to restore
  baseline: string   // the disk text the buffer diverged from (for on-reopen conflict detection)
}

export type PaneConfig = TerminalConfig | EditorConfig | ExplorerConfig

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
export interface ReadResult { content: string; tooLarge: boolean }
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
 *  short commit sha when `detached` is true. `dirty` = staged + unstaged + untracked > 0. */
export interface GitStatus {
  root: string
  branch: string
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  unstaged: number
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

export const SCHEMA_VERSION = 7

/** A saved, named command a user can run on click in a terminal. Persisted (pane- or
 *  workspace-scoped). Runtime sending reuses encodeBroadcast(command, 'keys', true). */
export interface RunCommand {
  id: string
  label: string
  command: string
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
