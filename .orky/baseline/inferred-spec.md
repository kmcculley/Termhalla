> **⚠ INFERRED BASELINE — a human must review and confirm before this governs anything. These requirements were lifted from existing code and describe current behavior, which may include bugs.**

**Status:** confirmed
**Generated:** 2026-06-29
**Confirmed-by:** Kevin (2026-06-29)

## Concerns
`[security]` `[determinism]` `[data-provenance]` `[ux]` `[doc-drift]` `[performance]`

Notes on scope: requirements below describe the **pure, headlessly-observable** behavior recovered from
the code, plus a handful of architecture-level invariants (marked `Characterized-by: none`) that the
vitest profile cannot pin and that need the e2e/Electron harness instead. Where the recovered behavior
looks wrong, the requirement still states what the code *currently does*; the suspicion is recorded in
`architecture.md` → "Suspected issues", not encoded as correctness here.

---

### REQ-001 — Three-layer process isolation
The app runs as three sandboxed layers — privileged `main`, an isolated `renderer` with no Node access,
and a `preload` bridge — with `contextIsolation: true` and `nodeIntegration: false`, so the renderer
reaches Node only through the typed `window.api`.
**Acceptance:** `BrowserWindow` webPreferences set `contextIsolation: true` and `nodeIntegration: false`;
the renderer has no direct `require`/`node:*` access.
**Source:** `src/main/index.ts`, `src/preload/`, `docs/architecture.md` → Security
**Characterized-by:** none — requires a live Electron window (e2e harness), not headlessly testable.

### REQ-002 — Typed IPC contract is the only main↔renderer surface
Every cross-layer call goes through channels declared in the shared contract (`domain:verb` names) and
the `TermhallaApi` interface; request/response uses `invoke`↔`handle`, push events use
`webContents.send`→`on*` subscriptions returning an unsubscribe function.
**Acceptance:** all renderer→main and main→renderer traffic is mediated by `CH` channels + `TermhallaApi`
declared in `ipc-contract.ts`; no other bridge is exposed on `window`.
**Source:** `src/shared/ipc-contract.ts`, `src/renderer/api.ts`
**Characterized-by:** none — contract conformance needs the running preload/ipcMain (e2e harness).

### REQ-003 — Main→renderer pushes survive teardown
Push events are wrapped in `safeSend`, which checks `win.isDestroyed()` / `webContents.isDestroyed()`
and swallows the throw, so a late event (e.g. a PTY exit after a window closes) never crashes shutdown.
**Acceptance:** a push dispatched to a destroyed window is a no-op, not an "Object has been destroyed"
throw.
**Source:** `src/main/ipc/register.ts` (`safeSend`)
**Characterized-by:** none — requires a real destroyed `BrowserWindow` (e2e harness).

### REQ-004 — Terminal status state machine (OSC 133 + output silence)
A terminal's status is `idle | busy | needs-input` with a `lastExit`. An OSC 133 `C` (command-start)
sets `busy`; `A` (prompt) sets `idle`; `D` (command-done) records `lastExit` (`success` for exit 0, else
`failure`) **without** changing the state; with no markers, real printable output flips `idle→busy`, and
sustained silence ticks back toward `idle`/`needs-input`.
**Acceptance:** a fresh tracker is `idle@since=ctorTime`; `C`→busy, `D(0)` keeps busy & sets
`lastExit:'success'`, `A`→idle; no-marker output→busy then a quiet `tick` over a shell prompt→idle.
**Source:** `src/main/status/status-tracker.ts` (`StatusTracker`)
**Characterized-by:** CHAR-004

### REQ-005 — Needs-input prompt detection
While busy and quiet for at least `quietMs`, a terminal whose tail's last non-blank line matches a known
input-prompt pattern (password/passphrase/`[y/n]`/`(yes/no)`/press-any-key/`continue?`/trailing `? `) is
classified `needs-input`. Detection is disabled when `cfg.enabled` is false.
**Acceptance:** `computeNeedsInput(600,'Password: ',cfg)===true`; `false` when quiet<`quietMs`, when the
tail is not a recognized prompt, or when disabled.
**Source:** `src/main/status/needs-input.ts` (`computeNeedsInput`, `tailMatchesInputPrompt`,
`DEFAULT_NEEDS_INPUT_PATTERNS`)
**Characterized-by:** CHAR-002

### REQ-006 — Idle-fallback heuristic for marker-less / AI terminals
A busy terminal is allowed back to idle on silence: only after `heuristicIdleMs`; never while sitting at
an input prompt; on the fast path when there are no OSC markers and the tail is a recognized shell prompt;
otherwise only after sustained silence (`heuristicIdleHardMs`). For a detected AI session it idles on
sustained silence only once the "esc to interrupt" indicator has lapsed (`aiWorkingRecent` false).
**Acceptance:** `computeIdleFallback(2000,'PS C:\\> ',false,cfg)===true`;
`(2000,'PS C:\\> ',true,cfg)===false` but `(9000,...,true,cfg)===true`; `(9000,'Password: ',…)===false`;
AI: `(9000,box,true,cfg,{aiActive:true,aiWorkingRecent:false})===true`, `…,true})===false`.
**Source:** `src/main/status/needs-input.ts` (`computeIdleFallback`, `AGENT_WORKING_RE`,
`AGENT_WORKING_GRACE_MS`)
**Characterized-by:** CHAR-003

### REQ-007 — Status tail is ANSI-stripped and screen-repaints are excluded
The status tail and quiet-timer use printable text only: `stripAnsi` removes VT/CSI/OSC escapes, and a
chunk that **begins** with a cursor-home sequence is treated as a screen repaint (`isPureControl` true)
and excluded, so a full-screen ConPTY repaint cannot evict the real prompt from the ~400-char tail.
**Acceptance:** `stripAnsi('\x1b[31mhi\x1b[0m')==='hi'`; `isPureControl('\x1b[Hreal text')===true`;
`isPureControl('hello')===false`.
**Source:** `src/main/status/needs-input.ts` (`stripAnsi`, `isPureControl`, `CURSOR_HOME_RE`)
**Characterized-by:** CHAR-001

### REQ-008 — cwd extraction from OSC sequences
The cwd parser extracts a working directory from OSC 9;9 (PowerShell `…;9;<path>`) and OSC 7
(`file://host/<path>`) sequences, translating DOS (`/C:/…`), msys (`/c/…`), and WSL (`/mnt/c/…`) forms
to Windows paths and URL-decoding; unrelated OSC sequences and plain output yield null.
**Acceptance:** `push('\x1b]9;9;C:\\dev\\foo\x07')==='C:\\dev\\foo'`;
`push('\x1b]7;file://host/mnt/c/work\x07')==='C:\\work'`; plain output / OSC 0 title → null.
**Source:** `src/main/status/cwd-parser.ts` (`CwdParser`, `fileUrlToWindows`)
**Characterized-by:** CHAR-005

### REQ-009 — Process-tree reconstruction from CIM JSON
`Get-CimInstance` JSON (a single object or an array) parses into typed rows — dropping rows without a
finite pid, tolerating malformed JSON as `[]` — with WMI `/Date(ms)/` and ISO dates parsed (0 when
unknown) and `.exe` stripped from names.
**Acceptance:** a single-object JSON yields one row; a bad pid is dropped; `parseCimRows('not json')===[]`;
`parseCimDate('/Date(1700000000000)/')===1700000000000`; `cleanName('node.exe')==='node'`.
**Source:** `src/main/proc/proc-tree.ts` (`parseCimRows`, `parseCimDate`, `cleanName`)
**Characterized-by:** CHAR-006

### REQ-010 — Descendant tree & foreground selection
The descendant tree under a shell pid excludes the shell, is emitted DFS pre-order with a `depth`, and
sorts siblings ascending by creation time; an empty command line falls back to the cleaned name. The
foreground process follows the most-recently-created child chain to the deepest leaf; an idle shell with
no children yields an empty foreground and tree.
**Acceptance:** for the CHAR-007 fixture, `descendantsOf` → `[['node',0],['git',0],['less',1]]`,
`pickForeground` → pid 400 (`less`), `buildProcInfo(rows,999)==={foreground:'',tree:[]}`.
**Source:** `src/main/proc/proc-tree.ts` (`descendantsOf`, `pickForeground`, `buildProcInfo`)
**Characterized-by:** CHAR-007

### REQ-011 — AI-session detection from the process tree
A Claude or Codex session is detected when any node's command or name matches the AI patterns: bare
`claude`/`codex` only with an executable extension (`.exe/.cmd/.bat/.ps1`) so a `claude.md` argument is
not a false positive, plus the `claude-code`/`@anthropic-ai/claude`/`@openai/codex` package forms. Claude
takes priority over Codex; no match yields null.
**Acceptance:** the claude-code CLI, a `claude.cmd` shim, and bare `claude` match `{tool:'claude'}`;
`@openai/codex` matches `{tool:'codex'}`; `vim claude.md` and an ordinary tree yield null.
**Source:** `src/main/ai/classify-ai.ts` (`classifyAiSession`, `AI_TOOLS`)
**Characterized-by:** CHAR-008  *(see Suspected issue #1: substring forms are unanchored)*

### REQ-012 — Context-window selection for usage scoring
The Claude context window is 1,000,000 tokens when the model id **or** the settings alias carries a
`[1m]` flag, else 200,000; and it auto-bumps to 1M when the observed context already exceeds 200k (so the
reported percentage never exceeds 100%).
**Acceptance:** `windowFor('claude-opus-4-8')===200000`; `windowFor('claude-opus-4-8','opus[1m]')===1000000`;
`computeContextWindow('unknown','',300000)===1000000`.
**Source:** `src/main/usage/parse-usage.ts` (`windowFor`, `computeContextWindow`)
**Characterized-by:** CHAR-009

### REQ-013 — Claude transcript usage aggregation
Token usage is summed across `assistant` turns of a JSONL transcript (input/output/cache-read/
cache-creation), the current `contextTokens` is the **last** assistant turn's input-side total
(input+cacheRead+cacheCreation), and `contextPct` = round(contextTokens/contextWindow*100); non-assistant
and unparseable lines are skipped; empty input yields all-zero metrics (window 200000).
**Acceptance:** the CHAR-010 two-turn transcript yields
`{input:300,output:110,cacheRead:30,cacheCreation:5,contextTokens:220,contextWindow:200000,contextPct:0}`;
`parseClaudeUsage('')` yields all-zero with window 200000.
**Source:** `src/main/usage/parse-usage.ts` (`parseClaudeUsage`)
**Characterized-by:** CHAR-010

### REQ-014 — Cloud probe outcome classification
One probe outcome maps to a `CloudStatus` without throwing: `ENOENT`→`not-installed`; any other spawn
error→`error`; non-zero exit→`logged-out`; exit 0 with parseable output→`logged-in` (with account +
carried base fields); exit 0 with unparseable output→`error` (treated as CLI format drift).
**Acceptance:** the five CHAR-011 outcomes map to
`not-installed/error/logged-out/logged-in/error` respectively, with base fields (`id,label,family,
profile,checkedAt`) preserved.
**Source:** `src/main/cloud/classify.ts` (`classifyProbe`)
**Characterized-by:** CHAR-011

### REQ-015 — Per-family cloud chip grouping
A flat `CloudStatus[]` collapses into per-family groups in first-seen order, each carrying the first
member's label, a `loggedIn`/`total` count, and a summary state by precedence: all not-installed →
not-installed; only checking/not-installed → checking; any logged-in → logged-in; any logged-out →
logged-out; else error.
**Acceptance:** two `aws` members (logged-in + logged-out) and one `azure` member group as
`['aws','azure']` with the aws summary `logged-in` (loggedIn 1, total 2) and azure `not-installed`.
**Source:** `src/shared/group-cloud.ts` (`groupCloudStatuses`, `summarize`)
**Characterized-by:** CHAR-012

### REQ-016 — Git porcelain v2 parsing
`git status --porcelain=v2 --branch` parses into branch, detached flag (branch = short oid when
detached), upstream, ahead/behind, and staged/unstaged/untracked counts (`1`/`2` entries split by the XY
field, `u` counted as unstaged, `?` as untracked), with `dirty` = staged+unstaged+untracked > 0.
**Acceptance:** the CHAR-018 fixture yields
`{branch:'main',detached:false,upstream:'origin/main',ahead:2,behind:1,staged:1,unstaged:1,untracked:1,
dirty:true}`; a `(detached)` head yields `branch:'abcdef1',detached:true,dirty:false`.
**Source:** `src/main/git/parse-status.ts` (`parseStatus`)
**Characterized-by:** CHAR-018  *(see Suspected issue #3: `u` unmerged counted only as unstaged)*

### REQ-017 — Keybinding resolution & dispatch
Shortcuts require Ctrl/⌘ (mod). Defaults are overlaid with user overrides (a chordKey string, or `'none'`
to unbind); `Ctrl+1..9` is a reserved non-rebindable workspace jump checked before any rebind; a chord is
a legal rebind only if it has mod + a real, non-reserved, non-`+` key. Chords round-trip through
`chordKey`/`parseChordKey` and display via `formatChord` (mod → "Ctrl").
**Acceptance:** `matchShortcut(Ctrl+K)→{type:'toggle-palette'}`, `matchShortcut(Ctrl+1)→
{type:'jump-workspace',index:0}`, no-mod→null; `resolveBindings({'toggle-palette':'none'})` omits it;
`isValidRebind` rejects no-mod / digit / `+` / modifier-only chords.
**Source:** `src/shared/keybindings.ts` (`resolveBindings`, `matchShortcut`, `isValidRebind`, `chordKey`,
`parseChordKey`, `formatChord`)
**Characterized-by:** CHAR-013

### REQ-018 — Saved run-command list operations are immutable & id-stable
Adding, updating, and removing saved run commands return new arrays; `add` treats `undefined` as empty;
`update` patches only the matching id and never changes the id; `remove` drops the matching id; unknown
ids are no-ops.
**Acceptance:** `addRunCommand(undefined,a)===[a]`; `updateRunCommand([a],'1',{label:'b',id:'X'})` keeps
id `'1'` with label `'b'`; `removeRunCommand([a],'1')===[]`.
**Source:** `src/shared/run-commands.ts` (`addRunCommand`, `updateRunCommand`, `removeRunCommand`)
**Characterized-by:** CHAR-014

### REQ-019 — Terminal font zoom is clamped and notch-stepped
A Ctrl+wheel notch changes terminal font size by 1px (up grows, down shrinks), clamped to [8,32]; a zero
delta is a no-op.
**Acceptance:** `nextFontSize(14,-100)===15`, `nextFontSize(14,100)===13`, `nextFontSize(14,0)===14`,
`nextFontSize(32,-1)===32`, `nextFontSize(8,1)===8`.
**Source:** `src/shared/font-zoom.ts` (`nextFontSize`, `FONT_SIZE_MIN`, `FONT_SIZE_MAX`)
**Characterized-by:** CHAR-015

### REQ-020 — Clickable image-link detection in terminal output
Image references are detected by extension (png/jpg/jpeg/gif/webp/svg/bmp/avif/ico): `imageExt` returns
the lowercased extension or null; `isImageUrl` classifies a URL after stripping query/hash;
`findImagePaths` finds quoted (space-bearing) and bare image paths, trims wrapping brackets/trailing
punctuation, and excludes URLs; `resolveImageSrc` passes absolute paths through, expands `~`/`~/` to
home, and otherwise joins the cwd.
**Acceptance:** `imageExt('shot.PNG')==='png'`, `isImageUrl('http://x/a.png?q=1')===true`,
`findImagePaths('open "my dir/a.png" now')→['my dir/a.png']` (URLs excluded),
`resolveImageSrc('~/a.png','C:\\dev','C:\\Users\\k')==='C:\\Users\\k\\a.png'`.
**Source:** `src/shared/terminal-links.ts` (`imageExt`, `isImageUrl`, `findImagePaths`, `resolveImageSrc`)
**Characterized-by:** CHAR-016

### REQ-021 — Editor language selection by file extension
The Monaco language id is chosen from the file extension via a fixed map (e.g. ts/tsx→typescript,
py→python, md→markdown), case-insensitively; an unknown or extension-less path is `plaintext`.
**Acceptance:** `languageForPath('src/a.ts')==='typescript'`, `'s.PY'→'python'`, `'README.md'→'markdown'`,
`'mystery.zzz'→'plaintext'`, `'Dockerfile'→'plaintext'` (no extension).
**Source:** `src/shared/language.ts` (`languageForPath`)
**Characterized-by:** CHAR-017

### REQ-022 — A pane's project key resolution order
A pane's "project" is its git repo root if known, else its live cwd, else its persisted terminal cwd,
else `''`; a null paneId yields `''`.
**Acceptance:** null→`''`; git root present→root; no git but live cwd→cwd; only a persisted terminal pane
cwd→that; nothing→`''`.
**Source:** `src/shared/project-key.ts` (`resolveProjectKey`)
**Characterized-by:** CHAR-019

### REQ-023 — Search query sanitization & segment pruning
A free-text search query becomes a safe FTS5 MATCH expression — each whitespace token wrapped in double
quotes (embedded quotes stripped) and implicitly ANDed, blank input → `''` — so FTS5 specials can never
cause a syntax error; the segment index prunes the oldest rows when count exceeds the cap (default
50000), by the overage amount (0 within cap).
**Acceptance:** `toMatchExpr('foo bar')==='"foo" "bar"'`, `toMatchExpr('foo*')==='"foo*"'`,
`toMatchExpr('   ')===''`; `overage(100,50)===50`, `overage(10,50)===0`, `SEGMENT_CAP===50000`.
**Source:** `src/main/search/fts-query.ts` (`toMatchExpr`), `src/main/search/prune-policy.ts` (`overage`,
`SEGMENT_CAP`)
**Characterized-by:** CHAR-020

### REQ-024 — Versioned persistence under Electron userData with no secrets
Persistent data lives under the Electron `userData` dir as discrete files (`workspaces/<id>.json`,
`app-state.json`, `quick.json`, `editor-drafts.json`, `notes.json`, `search.db`, `shell-integration/`),
gated by `SCHEMA_VERSION`; `quick.json` is sanitized by `normalizeQuick` on read+write; SSH stores
host/user/port + identity-file *path* only and cloud status persists nothing.
**Acceptance:** the persistence paths resolve under `userData`; `normalizeQuick` strips disallowed fields;
no secret material is written to disk.
**Source:** `src/main/persistence/paths.ts`, `src/main/persistence/quick-store.ts` (`normalizeQuick`),
`src/shared/types.ts` (`SCHEMA_VERSION`), `docs/architecture.md` → Persistence/Security
**Characterized-by:** none — exercises real disk I/O under Electron `app.getPath('userData')` (e2e/fs
harness); `normalizeQuick` itself is already covered by the pre-existing `tests/shared/quick.test.ts`.
