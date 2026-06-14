# Termhalla Phase 2 — Status & Alert Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each terminal reports busy / idle / needs-input — detected in main from the PTY byte stream (injected OSC 133 markers for PowerShell + bash, heuristics elsewhere) — surfaced as pane borders, workspace-tab badges, and OS notifications, configurable per terminal.

**Architecture:** A status engine in the main process (`src/main/status/`) observes a copy of each session's output, parses OSC 133 markers, runs a per-session state machine + needs-input heuristic, and emits status over a new `pty:status` IPC channel. `PtyManager` injects per-shell integration scripts at spawn and routes bytes to the engine. The renderer store holds per-pane status; `WorkspaceView`/`WorkspaceTabs` render borders + badges; a per-terminal settings popover edits `TerminalConfig.alerts`.

**Tech Stack:** (unchanged from Phase 1) Electron, TypeScript, electron-vite, React, zustand, react-mosaic, xterm.js, node-pty, vitest, @playwright/test.

**Pre-req:** Phase 1 merged to master. Create the working branch before Task 1:
`git checkout -b feat/phase2-status-engine`

---

## File Structure

```
src/shared/
  types.ts            # MODIFY: add TermState, TerminalStatus, AlertConfig; TerminalConfig.alerts?; SCHEMA_VERSION=2
  alerts.ts           # NEW: DEFAULT_ALERTS + resolveAlerts()
  ipc-contract.ts     # MODIFY: CH.ptyStatus, CH.notify; NotifyArgs; TermhallaApi.onPtyStatus/notify
src/main/status/
  osc133-parser.ts    # NEW: Osc133Parser (pure)
  needs-input.ts      # NEW: computeNeedsInput + looksLikePrompt + patterns (pure)
  status-tracker.ts   # NEW: StatusTracker state machine (pure)
  status-engine.ts    # NEW: StatusEngine (sessions map + tick timer)
  integration-scripts.ts # NEW: ps1/sh content + writeIntegrationScripts()
  shell-integration.ts   # NEW: shellInjection() (pure mapping)
src/main/
  pty/pty-manager.ts  # MODIFY: inject scripts, route bytes to engine, status on exit
  ipc/register.ts     # MODIFY: build engine, write scripts, send status, notify handler
src/preload/index.ts  # MODIFY: expose onPtyStatus + notify
src/renderer/
  store.ts            # MODIFY: statuses map, setStatus(+notify), updatePaneConfig
  App.tsx             # MODIFY: subscribe onPtyStatus -> setStatus
  components/WorkspaceView.tsx   # MODIFY: status border + data-status + gear/settings
  components/WorkspaceTabs.tsx   # MODIFY: per-tab status badges
  components/TerminalSettings.tsx # NEW: per-terminal popover
  index.css           # MODIFY: status border classes + animations
tests/shared/alerts.test.ts                 # NEW
tests/main/osc133-parser.test.ts            # NEW
tests/main/needs-input.test.ts              # NEW
tests/main/status-tracker.test.ts           # NEW
tests/main/status-engine.test.ts            # NEW
tests/main/shell-integration.test.ts        # NEW
tests/e2e/status.spec.ts                     # NEW
```

All commits use: `git -c user.name='Termhalla Dev' -c user.email='kevin.mcculley@gmail.com' commit ...` if git lacks identity, and append the body trailer:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
Use the PowerShell tool for npm/npx (Windows).

---

## Task 1: Status types + alert defaults

**Files:** Modify `src/shared/types.ts`; Create `src/shared/alerts.ts`, `tests/shared/alerts.test.ts`

- [ ] **Step 1: Edit `src/shared/types.ts`** — add the status/alert types, extend `TerminalConfig`, bump the schema version.

Add these exports (place the new types near `TerminalConfig`):
```ts
export type TermState = 'idle' | 'busy' | 'needs-input'

export interface TerminalStatus {
  state: TermState
  lastExit?: 'success' | 'failure'
  since: number
}

export interface AlertConfig {
  border?: boolean
  tabBadge?: boolean
  osNotification?: boolean
  needsInput?: boolean
}
```
Change `TerminalConfig` to add an optional `alerts` field (keep `name?`):
```ts
export interface TerminalConfig {
  kind: 'terminal'
  shellId: string
  cwd: string
  name?: string
  alerts?: AlertConfig
}
```
Change the schema constant:
```ts
export const SCHEMA_VERSION = 2
```

- [ ] **Step 2: Write the failing test `tests/shared/alerts.test.ts`**
```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_ALERTS, resolveAlerts } from '@shared/alerts'

describe('resolveAlerts', () => {
  it('returns all-on defaults when config is undefined', () => {
    expect(resolveAlerts(undefined)).toEqual({
      border: true, tabBadge: true, osNotification: true, needsInput: true
    })
  })
  it('merges a partial override onto defaults', () => {
    expect(resolveAlerts({ osNotification: false })).toEqual({
      border: true, tabBadge: true, osNotification: false, needsInput: true
    })
  })
  it('DEFAULT_ALERTS is all-on', () => {
    expect(DEFAULT_ALERTS).toEqual({ border: true, tabBadge: true, osNotification: true, needsInput: true })
  })
})
```

- [ ] **Step 3: Run test, confirm FAIL**
Run: `npx vitest run tests/shared/alerts.test.ts` → FAIL (module not found).

- [ ] **Step 4: Create `src/shared/alerts.ts`**
```ts
import type { AlertConfig } from './types'

export const DEFAULT_ALERTS: Required<AlertConfig> = {
  border: true, tabBadge: true, osNotification: true, needsInput: true
}

export function resolveAlerts(a: AlertConfig | undefined): Required<AlertConfig> {
  return { ...DEFAULT_ALERTS, ...(a ?? {}) }
}
```

- [ ] **Step 5: Run test + typecheck**
Run: `npx vitest run tests/shared/alerts.test.ts` → 3 pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 6: Commit**
```
git add -A && git commit -m "feat: status/alert types + alert config defaults"
```

---

## Task 2: OSC 133 parser (TDD)

**Files:** Create `src/main/status/osc133-parser.ts`, `tests/main/osc133-parser.test.ts`

- [ ] **Step 1: Write the failing test `tests/main/osc133-parser.test.ts`**
```ts
import { describe, it, expect } from 'vitest'
import { Osc133Parser } from '../../src/main/status/osc133-parser'

const ESC = '\x1b', BEL = '\x07'
const mark = (body: string) => `${ESC}]133;${body}${BEL}`

describe('Osc133Parser', () => {
  it('extracts a single A marker amid normal text', () => {
    const p = new Osc133Parser()
    expect(p.push(`hello ${mark('A')}world`)).toEqual([{ kind: 'A' }])
  })
  it('parses D with an exit code', () => {
    const p = new Osc133Parser()
    expect(p.push(mark('D;0'))).toEqual([{ kind: 'D', exit: 0 }])
    expect(p.push(mark('D;1'))).toEqual([{ kind: 'D', exit: 1 }])
  })
  it('parses D with no exit code', () => {
    const p = new Osc133Parser()
    expect(p.push(mark('D'))).toEqual([{ kind: 'D', exit: undefined }])
  })
  it('extracts multiple markers in one chunk', () => {
    const p = new Osc133Parser()
    expect(p.push(`${mark('C')}out${mark('D;0')}${mark('A')}`))
      .toEqual([{ kind: 'C' }, { kind: 'D', exit: 0 }, { kind: 'A' }])
  })
  it('handles a marker whose body is split across two chunks', () => {
    const p = new Osc133Parser()
    expect(p.push(`${ESC}]133;D;`)).toEqual([])     // incomplete
    expect(p.push(`0${BEL}`)).toEqual([{ kind: 'D', exit: 0 }])
  })
  it('handles a marker whose START sequence is split across chunks', () => {
    const p = new Osc133Parser()
    expect(p.push(`done${ESC}]1`)).toEqual([])        // partial OSC prefix retained
    expect(p.push(`33;A${BEL}`)).toEqual([{ kind: 'A' }])
  })
  it('accepts the ESC-backslash string terminator', () => {
    const p = new Osc133Parser()
    expect(p.push(`${ESC}]133;A${ESC}\\`)).toEqual([{ kind: 'A' }])
  })
  it('returns nothing and does not grow its buffer on plain output', () => {
    const p = new Osc133Parser()
    expect(p.push('just regular output with a \x1b[32mcolor\x1b[0m code')).toEqual([])
    // a following real marker still parses (buffer was not corrupted)
    expect(p.push(mark('A'))).toEqual([{ kind: 'A' }])
  })
})
```

- [ ] **Step 2: Run test, confirm FAIL**
Run: `npx vitest run tests/main/osc133-parser.test.ts` → FAIL (module not found).

- [ ] **Step 3: Create `src/main/status/osc133-parser.ts`**
```ts
export interface MarkerEvent { kind: 'A' | 'B' | 'C' | 'D'; exit?: number }

const OSC = '\x1b]133;'

function parseBody(body: string): MarkerEvent | null {
  const parts = body.split(';')
  const kind = parts[0]
  if (kind === 'A' || kind === 'B' || kind === 'C') return { kind }
  if (kind === 'D') {
    if (parts[1] === undefined || parts[1] === '') return { kind: 'D', exit: undefined }
    const n = Number(parts[1])
    return { kind: 'D', exit: Number.isNaN(n) ? undefined : n }
  }
  return null
}

/** Stateful scanner: feed PTY output chunks, get OSC 133 marker events back.
 *  Keeps a small carry-over buffer so markers split across chunks still parse. */
export class Osc133Parser {
  private buf = ''

  push(chunk: string): MarkerEvent[] {
    this.buf += chunk
    const events: MarkerEvent[] = []

    while (true) {
      const start = this.buf.indexOf(OSC)
      if (start === -1) break
      const from = start + OSC.length
      const bel = this.buf.indexOf('\x07', from)
      const st = this.buf.indexOf('\x1b\\', from)
      let end = -1, termLen = 0
      if (bel !== -1 && (st === -1 || bel < st)) { end = bel; termLen = 1 }
      else if (st !== -1) { end = st; termLen = 2 }
      if (end === -1) { this.buf = this.buf.slice(start); return events } // incomplete; keep
      const ev = parseBody(this.buf.slice(from, end))
      if (ev) events.push(ev)
      this.buf = this.buf.slice(end + termLen)
    }

    // No complete or in-progress OSC marker remains. Keep only a trailing ESC-run
    // that could be the split start of a future marker; drop ordinary output.
    const lastEsc = this.buf.lastIndexOf('\x1b')
    this.buf = lastEsc !== -1 && OSC.startsWith(this.buf.slice(lastEsc))
      ? this.buf.slice(lastEsc)
      : ''
    return events
  }
}
```

- [ ] **Step 4: Run test, confirm PASS**
Run: `npx vitest run tests/main/osc133-parser.test.ts` → 8 pass.

- [ ] **Step 5: Commit**
```
git add -A && git commit -m "feat: OSC 133 marker parser with split-chunk handling"
```

---

## Task 3: needs-input heuristic + prompt detection (TDD)

**Files:** Create `src/main/status/needs-input.ts`, `tests/main/needs-input.test.ts`

- [ ] **Step 1: Write the failing test `tests/main/needs-input.test.ts`**
```ts
import { describe, it, expect } from 'vitest'
import {
  computeNeedsInput, looksLikePrompt,
  DEFAULT_NEEDS_INPUT_PATTERNS, type NeedsInputConfig
} from '../../src/main/status/needs-input'

const cfg = (over: Partial<NeedsInputConfig> = {}): NeedsInputConfig => ({
  enabled: true, quietMs: 10000, patterns: DEFAULT_NEEDS_INPUT_PATTERNS, heuristicIdleMs: 1500, ...over
})

describe('computeNeedsInput', () => {
  it('fires when quiet past threshold AND tail matches a y/N prompt', () => {
    expect(computeNeedsInput(11000, 'Overwrite? [y/N] ', cfg())).toBe(true)
  })
  it('fires on a password prompt', () => {
    expect(computeNeedsInput(12000, 'Enter password: ', cfg())).toBe(true)
  })
  it('does NOT fire before the quiet threshold (slow-but-chatty command)', () => {
    expect(computeNeedsInput(2000, 'Continue? [y/N] ', cfg())).toBe(false)
  })
  it('does NOT fire when the tail is just progress output', () => {
    expect(computeNeedsInput(15000, 'Building project... 42%', cfg())).toBe(false)
  })
  it('does NOT fire when disabled', () => {
    expect(computeNeedsInput(99000, 'Overwrite? [y/N] ', cfg({ enabled: false }))).toBe(false)
  })
  it('matches only the last line of the tail', () => {
    expect(computeNeedsInput(11000, 'compiled ok\nProceed? [y/N] ', cfg())).toBe(true)
    expect(computeNeedsInput(11000, 'Proceed? [y/N] \nnevermind, more logs', cfg())).toBe(false)
  })
})

describe('looksLikePrompt', () => {
  it('recognises a typical shell prompt tail', () => {
    expect(looksLikePrompt('PS C:\\Users\\kevin> ')).toBe(true)
    expect(looksLikePrompt('user@host:~$ ')).toBe(true)
  })
  it('rejects ordinary output', () => {
    expect(looksLikePrompt('still working on it')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test, confirm FAIL**
Run: `npx vitest run tests/main/needs-input.test.ts` → FAIL.

- [ ] **Step 3: Create `src/main/status/needs-input.ts`**
```ts
export interface NeedsInputConfig {
  enabled: boolean
  quietMs: number         // how long output must be silent before we suspect a wait
  patterns: RegExp[]      // tail patterns that indicate an input prompt
  heuristicIdleMs: number // (used by the tracker's no-integration idle heuristic)
}

export const DEFAULT_NEEDS_INPUT_PATTERNS: RegExp[] = [
  /password.*:\s*$/i,
  /passphrase.*:\s*$/i,
  /\[y\/n\]\s*$/i,
  /\(yes\/no\)\s*[:?]?\s*$/i,
  /press any key/i,
  /continue\?\s*$/i,
  /\?\s$/                  // a question ending in "? "
]

function lastLine(tail: string): string {
  const lines = tail.split(/\r?\n/)
  return lines[lines.length - 1] ?? ''
}

export function computeNeedsInput(quietMs: number, tail: string, cfg: NeedsInputConfig): boolean {
  if (!cfg.enabled) return false
  if (quietMs < cfg.quietMs) return false
  const line = lastLine(tail)
  return cfg.patterns.some(p => p.test(line))
}

export function looksLikePrompt(tail: string): boolean {
  return /[>$#%]\s*$/.test(lastLine(tail))
}
```

- [ ] **Step 4: Run test, confirm PASS**
Run: `npx vitest run tests/main/needs-input.test.ts` → 8 pass.

- [ ] **Step 5: Commit**
```
git add -A && git commit -m "feat: needs-input heuristic + prompt detection"
```

---

## Task 4: Status tracker state machine (TDD)

**Files:** Create `src/main/status/status-tracker.ts`, `tests/main/status-tracker.test.ts`

- [ ] **Step 1: Write the failing test `tests/main/status-tracker.test.ts`**
```ts
import { describe, it, expect } from 'vitest'
import { StatusTracker } from '../../src/main/status/status-tracker'
import { DEFAULT_NEEDS_INPUT_PATTERNS, type NeedsInputConfig } from '../../src/main/status/needs-input'

const cfg = (over: Partial<NeedsInputConfig> = {}): NeedsInputConfig => ({
  enabled: true, quietMs: 10000, patterns: DEFAULT_NEEDS_INPUT_PATTERNS, heuristicIdleMs: 1500, ...over
})

describe('StatusTracker (with integration markers)', () => {
  it('starts idle', () => {
    expect(new StatusTracker(0, cfg()).status().state).toBe('idle')
  })
  it('A -> idle, C -> busy, A -> idle', () => {
    const t = new StatusTracker(0, cfg())
    expect(t.onMarker('A', undefined, 1).state).toBe('idle')
    expect(t.onMarker('C', undefined, 2).state).toBe('busy')
    expect(t.onMarker('A', undefined, 3).state).toBe('idle')
  })
  it('D records lastExit applied at the next A', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 1)
    t.onMarker('D', 0, 2)
    expect(t.onMarker('A', undefined, 3)).toMatchObject({ state: 'idle', lastExit: 'success' })
    t.onMarker('C', undefined, 4)
    t.onMarker('D', 1, 5)
    expect(t.onMarker('A', undefined, 6)).toMatchObject({ state: 'idle', lastExit: 'failure' })
  })
  it('goes needs-input when busy, quiet past threshold, with a prompt tail; clears on new output', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)
    expect(t.tick(200).state).toBe('busy')        // not quiet long enough yet
    expect(t.tick(11000).state).toBe('needs-input')
    expect(t.onOutput('y\r\n', 11500).state).toBe('busy')  // user answered -> output -> busy
  })
})

describe('StatusTracker (heuristic, no markers)', () => {
  it('output -> busy, then long quiet with prompt tail -> idle', () => {
    const t = new StatusTracker(0, cfg())
    expect(t.onOutput('compiling...', 0).state).toBe('busy')
    expect(t.tick(1000).state).toBe('busy')                 // under heuristicIdleMs
    t.onOutput('\r\nPS C:\\> ', 1100)
    expect(t.tick(3000).state).toBe('idle')                 // quiet + prompt-looking tail
  })
})
```

- [ ] **Step 2: Run test, confirm FAIL**
Run: `npx vitest run tests/main/status-tracker.test.ts` → FAIL.

- [ ] **Step 3: Create `src/main/status/status-tracker.ts`**
```ts
import type { TerminalStatus, TermState } from '@shared/types'
import { computeNeedsInput, looksLikePrompt, type NeedsInputConfig } from './needs-input'

export class StatusTracker {
  private state: TermState = 'idle'
  private lastExit?: 'success' | 'failure'
  private since: number
  private lastOutputAt: number
  private tail = ''
  private hasMarkers = false

  constructor(now: number, private readonly cfg: NeedsInputConfig) {
    this.since = now
    this.lastOutputAt = now
  }

  onMarker(kind: 'A' | 'B' | 'C' | 'D', exit: number | undefined, now: number): TerminalStatus {
    this.hasMarkers = true
    if (kind === 'D') {
      if (exit !== undefined) this.lastExit = exit === 0 ? 'success' : 'failure'
    } else if (kind === 'A') {
      this.set('idle', now)
    } else { // B or C
      this.set('busy', now)
    }
    return this.status()
  }

  onOutput(text: string, now: number): TerminalStatus {
    this.lastOutputAt = now
    this.tail = (this.tail + text).slice(-400)
    if (this.state === 'needs-input') this.set('busy', now)
    if (!this.hasMarkers && this.state !== 'busy') this.set('busy', now)
    return this.status()
  }

  tick(now: number): TerminalStatus {
    const quietMs = now - this.lastOutputAt
    if (!this.hasMarkers && this.state === 'busy'
        && quietMs >= this.cfg.heuristicIdleMs && looksLikePrompt(this.tail)) {
      this.set('idle', now)
    }
    if (this.state === 'busy' && computeNeedsInput(quietMs, this.tail, this.cfg)) {
      this.set('needs-input', now)
    }
    return this.status()
  }

  status(): TerminalStatus {
    return { state: this.state, lastExit: this.lastExit, since: this.since }
  }

  private set(s: TermState, now: number): void {
    if (this.state !== s) { this.state = s; this.since = now }
  }
}
```

- [ ] **Step 4: Run test, confirm PASS**
Run: `npx vitest run tests/main/status-tracker.test.ts` → 6 pass.

- [ ] **Step 5: Commit**
```
git add -A && git commit -m "feat: per-session status state machine"
```

---

## Task 5: Status engine (sessions + tick timer, TDD)

**Files:** Create `src/main/status/status-engine.ts`, `tests/main/status-engine.test.ts`

- [ ] **Step 1: Write the failing test `tests/main/status-engine.test.ts`**
(The engine takes an injectable clock so the timer-free logic is deterministic. We exercise `feed`/`markExit` directly; the internal interval is not asserted here.)
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { StatusEngine } from '../../src/main/status/status-engine'
import type { TerminalStatus } from '@shared/types'

const ESC = '\x1b', BEL = '\x07'
const mark = (b: string) => `${ESC}]133;${b}${BEL}`

describe('StatusEngine', () => {
  let engine: StatusEngine | null = null
  afterEach(() => { engine?.dispose(); engine = null })

  it('emits only on status change and routes markers to the right session', () => {
    const events: Array<[string, TerminalStatus]> = []
    let clock = 0
    engine = new StatusEngine((id, st) => events.push([id, { ...st }]), () => clock)
    engine.register('t1')                       // emits initial idle
    engine.feed('t1', mark('C') + 'working')    // -> busy
    engine.feed('t1', 'more output')            // still busy -> no new emit
    engine.feed('t1', mark('D;0') + mark('A'))  // -> idle (success)

    const states = events.filter(e => e[0] === 't1').map(e => e[1].state)
    expect(states).toEqual(['idle', 'busy', 'idle'])
    expect(events.filter(e => e[0] === 't1').pop()![1].lastExit).toBe('success')
  })

  it('markExit drives the session back to idle', () => {
    const events: Array<[string, TerminalStatus]> = []
    let clock = 0
    engine = new StatusEngine((id, st) => events.push([id, { ...st }]), () => clock)
    engine.register('t1')
    engine.feed('t1', mark('C'))   // busy
    engine.markExit('t1', 0)       // idle
    expect(events.pop()![1].state).toBe('idle')
  })
})
```

- [ ] **Step 2: Run test, confirm FAIL**
Run: `npx vitest run tests/main/status-engine.test.ts` → FAIL.

- [ ] **Step 3: Create `src/main/status/status-engine.ts`**
```ts
import type { TerminalStatus } from '@shared/types'
import { Osc133Parser } from './osc133-parser'
import { StatusTracker } from './status-tracker'
import { DEFAULT_NEEDS_INPUT_PATTERNS, type NeedsInputConfig } from './needs-input'

interface Session { parser: Osc133Parser; tracker: StatusTracker; last: string }

function defaultConfig(): NeedsInputConfig {
  const envQuiet = Number(process.env.TERMHALLA_NEEDS_INPUT_QUIET_MS)
  return {
    enabled: true,
    quietMs: Number.isFinite(envQuiet) && envQuiet > 0 ? envQuiet : 10000,
    patterns: DEFAULT_NEEDS_INPUT_PATTERNS,
    heuristicIdleMs: 1500
  }
}

export class StatusEngine {
  private sessions = new Map<string, Session>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly onStatus: (id: string, status: TerminalStatus) => void,
    private readonly now: () => number = () => Date.now()
  ) {}

  register(id: string): void {
    this.sessions.set(id, {
      parser: new Osc133Parser(),
      tracker: new StatusTracker(this.now(), defaultConfig()),
      last: ''
    })
    this.emit(id)
    this.ensureTimer()
  }

  feed(id: string, data: string): void {
    const s = this.sessions.get(id); if (!s) return
    const t = this.now()
    for (const m of s.parser.push(data)) s.tracker.onMarker(m.kind, m.exit, t)
    s.tracker.onOutput(data, t)
    this.emit(id)
  }

  markExit(id: string, code: number): void {
    const s = this.sessions.get(id); if (!s) return
    const t = this.now()
    s.tracker.onMarker('D', code, t)
    s.tracker.onMarker('A', undefined, t)
    this.emit(id)
  }

  unregister(id: string): void {
    this.sessions.delete(id)
    if (this.sessions.size === 0) this.stopTimer()
  }

  dispose(): void { this.sessions.clear(); this.stopTimer() }

  private ensureTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      const t = this.now()
      for (const id of this.sessions.keys()) {
        this.sessions.get(id)!.tracker.tick(t)
        this.emit(id)
      }
    }, 500)
    // Don't keep the process alive for the tick timer.
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  private stopTimer(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private emit(id: string): void {
    const s = this.sessions.get(id); if (!s) return
    const st = s.tracker.status()
    const key = `${st.state}|${st.lastExit ?? ''}`
    if (key !== s.last) { s.last = key; this.onStatus(id, st) }
  }
}
```

- [ ] **Step 4: Run test, confirm PASS**
Run: `npx vitest run tests/main/status-engine.test.ts` → 2 pass.
Run: `npm test` → full suite green (Phase 1 + new: alerts 3, osc133 8, needs-input 8, tracker 6, engine 2).

- [ ] **Step 5: Commit**
```
git add -A && git commit -m "feat: status engine (sessions, tick timer, change-debounced emit)"
```

---

## Task 6: Shell-integration scripts + injector (TDD)

**Files:** Create `src/main/status/integration-scripts.ts`, `src/main/status/shell-integration.ts`, `tests/main/shell-integration.test.ts`

- [ ] **Step 1: Write the failing test `tests/main/shell-integration.test.ts`**
```ts
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
```

- [ ] **Step 2: Run test, confirm FAIL**
Run: `npx vitest run tests/main/shell-integration.test.ts` → FAIL.

- [ ] **Step 3: Create `src/main/status/integration-scripts.ts`**
(Script content emits OSC 133 markers. Both chain the user's existing prompt/rc.)
```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PS_FILE = 'termhalla.ps1'
export const SH_FILE = 'termhalla.sh'

// PowerShell: wrap the existing prompt to emit D (last exit) + A (prompt);
// a PSReadLine Enter handler emits C (command start). Degrades to A/D if absent.
export const POWERSHELL_INTEGRATION = String.raw`
$global:__thOrigPrompt = $function:prompt
function global:prompt {
  $code = $LASTEXITCODE; if ($null -eq $code) { $code = 0 }
  $e = [char]27; $b = [char]7
  [Console]::Write("$e]133;D;$code$b")
  [Console]::Write("$e]133;A$b")
  if ($global:__thOrigPrompt) { & $global:__thOrigPrompt } else { "PS " + (Get-Location) + "> " }
}
try {
  Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
    $e = [char]27; $b = [char]7
    [Console]::Write("$e]133;C$b")
    [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
  }
} catch { }
`

// bash: source user's rc, then emit D+A in PROMPT_COMMAND and C in a DEBUG trap.
export const BASH_INTEGRATION = String.raw`
[ -f ~/.bashrc ] && source ~/.bashrc
__th_prompt() { local c=$?; printf '\033]133;D;%s\007\033]133;A\007' "$c"; }
case "$PROMPT_COMMAND" in
  *__th_prompt*) ;;
  *) PROMPT_COMMAND="__th_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;
esac
__th_preexec() {
  [ -n "$COMP_LINE" ] && return
  [ "$BASH_COMMAND" = "$PROMPT_COMMAND" ] && return
  printf '\033]133;C\007'
}
trap '__th_preexec' DEBUG
`

/** Write both integration scripts into `dir`, creating it if needed. Idempotent. */
export function writeIntegrationScripts(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, PS_FILE), POWERSHELL_INTEGRATION, 'utf8')
  writeFileSync(join(dir, SH_FILE), BASH_INTEGRATION, 'utf8')
}
```

- [ ] **Step 4: Create `src/main/status/shell-integration.ts`**
```ts
import { join } from 'node:path'
import type { ShellInfo } from '@shared/types'
import { PS_FILE, SH_FILE } from './integration-scripts'

export const PS_SCRIPT = PS_FILE
export const SH_SCRIPT = SH_FILE

export interface Injection { args: string[]; env: Record<string, string> }

/** Map a shell to the spawn args/env that inject OSC 133 markers, or null for heuristics-only. */
export function shellInjection(shell: ShellInfo, scriptDir: string): Injection | null {
  if (shell.id === 'pwsh' || shell.id === 'powershell') {
    const path = join(scriptDir, PS_FILE)
    return { args: ['-NoExit', '-Command', `. '${path.replace(/'/g, "''")}'`], env: {} }
  }
  if (shell.id === 'gitbash' || shell.id === 'wsl') {
    const path = join(scriptDir, SH_FILE)
    return { args: ['--rcfile', path, '-i'], env: {} }
  }
  return null
}
```

- [ ] **Step 5: Run test + typecheck**
Run: `npx vitest run tests/main/shell-integration.test.ts` → 3 pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 6: Commit**
```
git add -A && git commit -m "feat: shell-integration scripts + per-shell injector"
```

---

## Task 7: IPC contract + preload (status + notify)

**Files:** Modify `src/shared/ipc-contract.ts`, `src/preload/index.ts`

- [ ] **Step 1: Edit `src/shared/ipc-contract.ts`**
Add the import of `TerminalStatus`, two channels, the `NotifyArgs` type, and two API methods.

Change the import line:
```ts
import type { ShellInfo, Workspace, AppState, TerminalStatus } from './types'
```
Add to the `CH` object (before the closing `} as const`):
```ts
  ptyStatus: 'pty:status',  // main -> renderer event
  notify: 'app:notify'
```
Add a payload type:
```ts
export interface NotifyArgs { title: string; body: string }
```
Add to the `TermhallaApi` interface:
```ts
  onPtyStatus(cb: (id: string, status: TerminalStatus) => void): () => void
  notify(args: NotifyArgs): void
```

- [ ] **Step 2: Edit `src/preload/index.ts`**
Add the two methods to the `api` object (anywhere inside the object literal):
```ts
  notify: (a) => ipcRenderer.send(CH.notify, a),
  onPtyStatus: (cb) => {
    const h = (_e: unknown, id: string, status: import('@shared/types').TerminalStatus) => cb(id, status)
    ipcRenderer.on(CH.ptyStatus, h as never)
    return () => ipcRenderer.removeListener(CH.ptyStatus, h as never)
  },
```

- [ ] **Step 3: Typecheck**
Run: `npm run typecheck` → clean. (The preload `api` is typed `TermhallaApi`, so a missing/mismatched method fails here.)

- [ ] **Step 4: Commit**
```
git add -A && git commit -m "feat: pty:status + notify IPC contract and preload bridge"
```

---

## Task 8: Wire engine + injection into PtyManager and register

**Files:** Modify `src/main/pty/pty-manager.ts`, `src/main/ipc/register.ts`

- [ ] **Step 1: Replace `src/main/pty/pty-manager.ts`**
(Adds a `StatusEngine` + `scriptDir`; injects per-shell; routes bytes to the engine; emits status lifecycle.)
```ts
import * as pty from 'node-pty'
import type { ShellInfo } from '@shared/types'
import { StatusEngine } from '../status/status-engine'
import { shellInjection } from '../status/shell-integration'

export interface PtySession { id: string; proc: pty.IPty }

export class PtyManager {
  private sessions = new Map<string, PtySession>()

  constructor(
    private readonly onData: (id: string, data: string) => void,
    private readonly onExit: (id: string, code: number) => void,
    private readonly engine: StatusEngine,
    private readonly scriptDir: string
  ) {}

  spawn(id: string, shell: ShellInfo, cwd: string, cols = 80, rows = 24): void {
    if (this.sessions.has(id)) return
    const dir = cwd && cwd.length ? cwd : (process.env.USERPROFILE ?? process.env.HOME ?? process.cwd())
    const inj = shellInjection(shell, this.scriptDir)
    const args = inj ? inj.args : shell.args
    const proc = pty.spawn(shell.path, args, {
      name: 'xterm-256color', cols, rows, cwd: dir,
      env: { ...process.env, ...(inj?.env ?? {}) } as Record<string, string>
    })
    this.engine.register(id)
    proc.onData(d => { this.engine.feed(id, d); this.onData(id, d) })
    proc.onExit(({ exitCode }) => {
      this.engine.markExit(id, exitCode); this.engine.unregister(id)
      this.onExit(id, exitCode); this.sessions.delete(id)
    })
    this.sessions.set(id, { id, proc })
  }

  write(id: string, data: string): void { this.sessions.get(id)?.proc.write(data) }
  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.proc.resize(Math.max(cols, 1), Math.max(rows, 1))
  }
  kill(id: string): void {
    this.sessions.get(id)?.proc.kill(); this.engine.unregister(id); this.sessions.delete(id)
  }
  killAll(): void { for (const id of [...this.sessions.keys()]) this.kill(id) }
}
```

- [ ] **Step 2: Replace `src/main/ipc/register.ts`**
(Builds the engine, writes scripts, forwards status, handles notify.)
```ts
import { ipcMain, Notification, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { CH, type PtySpawnArgs, type PtyWriteArgs, type PtyResizeArgs, type NotifyArgs } from '@shared/ipc-contract'
import type { Workspace, AppState } from '@shared/types'
import { detectShells } from '../pty/shells'
import { PtyManager } from '../pty/pty-manager'
import { StatusEngine } from '../status/status-engine'
import { writeIntegrationScripts } from '../status/integration-scripts'
import { WorkspaceStore } from '../persistence/store'
import { userDataDir } from '../persistence/paths'

export function registerHandlers(win: BrowserWindow): PtyManager {
  const store = new WorkspaceStore(userDataDir())
  const shells = detectShells()

  const scriptDir = join(userDataDir(), 'shell-integration')
  writeIntegrationScripts(scriptDir)

  const engine = new StatusEngine((id, status) => win.webContents.send(CH.ptyStatus, id, status))
  const pty = new PtyManager(
    (id, data) => win.webContents.send(CH.ptyData, id, data),
    (id, code) => win.webContents.send(CH.ptyExit, id, code),
    engine, scriptDir
  )

  ipcMain.handle(CH.listShells, () => shells)
  ipcMain.handle(CH.listWorkspaceIds, () => store.listWorkspaceIds())
  ipcMain.handle(CH.loadWorkspace, (_e, id: string) => store.loadWorkspace(id))
  ipcMain.handle(CH.saveWorkspace, (_e, ws: Workspace) => store.saveWorkspace(ws))
  ipcMain.handle(CH.loadAppState, () => store.loadAppState())
  ipcMain.handle(CH.saveAppState, (_e, s: AppState) => store.saveAppState(s))

  ipcMain.handle(CH.ptySpawn, (_e, a: PtySpawnArgs) => {
    const shell = shells.find(s => s.id === a.shellId) ?? shells[0]
    pty.spawn(a.id, shell, a.cwd, a.cols, a.rows)
  })
  ipcMain.on(CH.ptyWrite, (_e, a: PtyWriteArgs) => pty.write(a.id, a.data))
  ipcMain.on(CH.ptyResize, (_e, a: PtyResizeArgs) => pty.resize(a.id, a.cols, a.rows))
  ipcMain.on(CH.ptyKill, (_e, id: string) => pty.kill(id))

  ipcMain.on(CH.notify, (_e, a: NotifyArgs) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: a.title, body: a.body })
    n.on('click', () => { win.show(); win.focus() })
    n.show()
  })

  return pty
}
```

- [ ] **Step 3: Typecheck + build**
Run: `npm run typecheck` → clean.
Run: `npm run build` → succeeds. Confirm `grep -o "preload/index\.[a-z]*" out/main/index.js` still prints `preload/index.mjs`.

- [ ] **Step 4: Full unit suite**
Run: `npm test` → all green (no test imports node-pty/electron, so unaffected).

- [ ] **Step 5: Commit**
```
git add -A && git commit -m "feat: wire status engine + shell injection into pty manager and ipc"
```

---

## Task 9: Renderer store — statuses, setStatus (+ notify), updatePaneConfig

**Files:** Modify `src/renderer/store.ts`

- [ ] **Step 1: Edit `src/renderer/store.ts`** — add imports, state, and actions.

Add to imports at the top:
```ts
import type { TerminalStatus, TerminalConfig } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
```
(Adjust the existing `@shared/types` import to also include `TerminalStatus, TerminalConfig` if it's a single import line.)

Add a module-level helper above `export const useStore`:
```ts
function findPaneConfig(s: { workspaces: Record<string, import('@shared/types').Workspace> }, paneId: string): TerminalConfig | undefined {
  for (const ws of Object.values(s.workspaces)) {
    const pane = ws.panes[paneId]
    if (pane) return pane.config
  }
  return undefined
}
```

Add to the `State` interface:
```ts
  statuses: Record<string, TerminalStatus>
  setStatus: (id: string, status: TerminalStatus) => void
  updatePaneConfig: (wsId: string, paneId: string, patch: Partial<TerminalConfig>) => void
```

Add `statuses: {},` to the initial state (next to `activeId: null,`).

Add these actions inside the returned store object (after `setNewTerminalShell`):
```ts
    setStatus: (id, status) => {
      const prev = get().statuses[id]
      set(s => ({ statuses: { ...s.statuses, [id]: status } }))
      if (status.state === 'needs-input' && prev?.state !== 'needs-input') {
        const cfg = findPaneConfig(get(), id)
        const alerts = resolveAlerts(cfg?.alerts)
        if (alerts.osNotification && typeof document !== 'undefined' && !document.hasFocus()) {
          api.notify({ title: 'Terminal needs input', body: cfg?.name ?? 'A terminal is waiting for input' })
        }
      }
    },

    updatePaneConfig: (wsId, paneId, patch) => {
      const ws = get().workspaces[wsId]
      const pane = ws?.panes[paneId]
      if (!pane) return
      const updated = { ...ws, panes: { ...ws.panes, [paneId]: { ...pane, config: { ...pane.config, ...patch } } } }
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: updated } }))
      void get().saveAll()
    },
```

- [ ] **Step 2: Typecheck**
Run: `npm run typecheck` → clean.

- [ ] **Step 3: Commit**
```
git add -A && git commit -m "feat: renderer status state + per-pane config updates"
```

---

## Task 10: Status border + settings gear in WorkspaceView; subscribe in App

**Files:** Modify `src/renderer/components/WorkspaceView.tsx`, `src/renderer/App.tsx`, `src/renderer/index.css`; Create `src/renderer/components/TerminalSettings.tsx`

- [ ] **Step 1: Create `src/renderer/components/TerminalSettings.tsx`**
```tsx
import type { TerminalConfig } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'

export function TerminalSettings(
  { config, onChange, onClose }: {
    config: TerminalConfig
    onChange: (patch: Partial<TerminalConfig>) => void
    onClose: () => void
  }
) {
  const a = resolveAlerts(config.alerts)
  const toggle = (key: keyof typeof a) => onChange({ alerts: { ...config.alerts, [key]: !a[key] } })
  return (
    <div data-testid="terminal-settings"
      style={{ position: 'absolute', right: 4, top: 28, zIndex: 10, background: '#252526',
        color: '#eee', border: '1px solid #444', borderRadius: 4, padding: 8, width: 220 }}
      onClick={e => e.stopPropagation()}>
      <label style={{ display: 'block', marginBottom: 6 }}>
        Name
        <input data-testid="setting-name" style={{ width: '100%' }}
          value={config.name ?? ''} placeholder="Terminal"
          onChange={e => onChange({ name: e.target.value })} />
      </label>
      {([['border', 'Status border'], ['tabBadge', 'Tab badge'],
         ['osNotification', 'OS notification'], ['needsInput', 'Needs-input detection']] as const)
        .map(([key, label]) => (
        <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" data-testid={`setting-${key}`}
            checked={a[key]} onChange={() => toggle(key)} />
          {label}
        </label>
      ))}
      <button data-testid="settings-close" style={{ marginTop: 8 }} onClick={onClose}>Close</button>
    </div>
  )
}
```

- [ ] **Step 2: Replace `src/renderer/components/WorkspaceView.tsx`**
(Adds: read status, wrap tile with `data-status` + border class, a gear button + settings popover, and a needs-input badge in the title.)
```tsx
import { useState } from 'react'
import { Mosaic, MosaicWindow } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import type { MosaicNode as ModelNode, Workspace } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { useStore } from '../store'
import { TerminalPane } from './TerminalPane'
import { TerminalSettings } from './TerminalSettings'

export function WorkspaceView({ ws }: { ws: Workspace }) {
  const setLayout = useStore(s => s.setLayout)
  const addTerminal = useStore(s => s.addTerminal)
  const closePane = useStore(s => s.closePane)
  const statuses = useStore(s => s.statuses)
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)

  if (ws.layout === null) {
    return (
      <div data-testid="empty-workspace" style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <button data-testid="add-first-terminal" onClick={() => addTerminal(ws.id, null, 'row')}>
          + New Terminal
        </button>
      </div>
    )
  }

  return (
    <Mosaic<string>
      value={ws.layout as ModelNode & string}
      onChange={(node) => setLayout(ws.id, (node as ModelNode) ?? null)}
      renderTile={(paneId, path) => {
        const pane = ws.panes[paneId]
        const status = statuses[paneId]
        const alerts = resolveAlerts(pane?.config.alerts)
        const state = status?.state ?? 'idle'
        const borderClass = alerts.border ? ` term-border term-${state}` +
          (state === 'idle' && status?.lastExit ? ` term-exit-${status.lastExit}` : '') : ''
        const needsInput = state === 'needs-input'
        return (
          <MosaicWindow<string>
            path={path}
            title={(needsInput ? '🔔 ' : '') + (pane?.config.name ?? 'Terminal')}
            toolbarControls={[
              <button key="gear" data-testid={`gear-${paneId}`} title="Terminal settings"
                onClick={() => setSettingsFor(settingsFor === paneId ? null : paneId)}>⚙</button>,
              <button key="split-row" data-testid={`split-${paneId}`} title="Split right"
                onClick={() => addTerminal(ws.id, paneId, 'row')}>⬌</button>,
              <button key="split-col" data-testid={`split-col-${paneId}`} title="Split down"
                onClick={() => addTerminal(ws.id, paneId, 'column')}>⬍</button>,
              <button key="close" data-testid={`close-${paneId}`}
                onClick={() => closePane(ws.id, paneId)}>✕</button>
            ]}
          >
            <div className={`term-tile${borderClass}`} data-status={state}
              data-testid={`tile-${paneId}`} style={{ position: 'relative', height: '100%' }}>
              {settingsFor === paneId && pane && (
                <TerminalSettings config={pane.config}
                  onChange={patch => updatePaneConfig(ws.id, paneId, patch)}
                  onClose={() => setSettingsFor(null)} />
              )}
              {pane ? <TerminalPane paneId={paneId} config={pane.config} /> : <div>missing pane</div>}
            </div>
          </MosaicWindow>
        )
      }}
    />
  )
}
```

- [ ] **Step 3: Edit `src/renderer/App.tsx`** — subscribe to status events.
Add the api import at the top of `App.tsx`:
```tsx
import { api } from './api'
```
Add a second `useEffect` (after the existing `beforeunload` flush effect):
```tsx
  useEffect(() => {
    const off = api.onPtyStatus((id, status) => useStore.getState().setStatus(id, status))
    return off
  }, [])
```

- [ ] **Step 4: Edit `src/renderer/index.css`** — append status border styling.
```css
.term-tile { box-sizing: border-box; border: 2px solid transparent; }
.term-border.term-busy { border-color: #1e88e5; animation: term-pulse 1.2s ease-in-out infinite; }
.term-border.term-needs-input { border-color: #ffb300; animation: term-flash 0.7s steps(1) infinite; }
.term-border.term-idle.term-exit-success { border-color: #2e7d32; animation: term-fade 4s forwards; }
.term-border.term-idle.term-exit-failure { border-color: #c62828; animation: term-fade 4s forwards; }
@keyframes term-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
@keyframes term-flash { 0%, 50% { border-color: #ffb300 } 51%, 100% { border-color: transparent } }
@keyframes term-fade { 0% { opacity: 1 } 100% { opacity: 0.15 } }
```

- [ ] **Step 5: Typecheck + build**
Run: `npm run typecheck` → clean.
Run: `npm run build` → succeeds.
Run: `npm test` → full unit suite green.

- [ ] **Step 6: Commit**
```
git add -A && git commit -m "feat: status borders, needs-input badge, per-terminal settings popover"
```

---

## Task 11: Workspace-tab status badges

**Files:** Modify `src/renderer/components/WorkspaceTabs.tsx`

- [ ] **Step 1: Replace `src/renderer/components/WorkspaceTabs.tsx`**
(Adds a per-tab badge: needs-input count, else a busy dot — honoring each terminal's `tabBadge` setting.)
```tsx
import type { Workspace } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { useStore } from '../store'

function tabBadge(ws: Workspace, statuses: Record<string, { state: string }>): string {
  let needs = 0, busy = false
  for (const paneId of Object.keys(ws.panes)) {
    if (!resolveAlerts(ws.panes[paneId].config.alerts).tabBadge) continue
    const st = statuses[paneId]?.state
    if (st === 'needs-input') needs++
    else if (st === 'busy') busy = true
  }
  if (needs > 0) return ` 🔔${needs}`
  if (busy) return ' •'
  return ''
}

export function WorkspaceTabs() {
  const {
    order, workspaces, activeId, setActive, newWorkspace,
    saveAll, shells, newTerminalShellId, setNewTerminalShell, statuses
  } = useStore()
  return (
    <div data-testid="workspace-tabs"
      style={{ display: 'flex', gap: 4, padding: 4, background: '#1e1e1e', alignItems: 'center' }}>
      {order.map(id => (
        <button key={id} data-testid={`tab-${id}`}
          onClick={() => setActive(id)}
          style={{ fontWeight: id === activeId ? 700 : 400 }}>
          {workspaces[id].name}{tabBadge(workspaces[id], statuses)}
        </button>
      ))}
      <button data-testid="new-workspace"
        onClick={() => newWorkspace(`Workspace ${order.length + 1}`)}>+</button>
      <span style={{ flex: 1 }} />
      <select data-testid="shell-picker" value={newTerminalShellId ?? ''}
        onChange={e => setNewTerminalShell(e.target.value)}>
        {shells.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <button data-testid="save-workspace" onClick={() => saveAll()}>Save</button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + build**
Run: `npm run typecheck` → clean.
Run: `npm run build` → succeeds.

- [ ] **Step 3: Commit**
```
git add -A && git commit -m "feat: per-workspace-tab status badges"
```

---

## Task 12: End-to-end status tests (Playwright)

**Files:** Create `tests/e2e/status.spec.ts`

- [ ] **Step 1: Create `tests/e2e/status.spec.ts`**
(Reuses the Phase 1 hermetic-launch + process-tree teardown. Sets a short needs-input quiet threshold via env so the needs-input test is fast and deterministic.)
```ts
import { test as base, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
    else process.kill(-pid, 'SIGKILL')
  } catch { /* gone */ }
}

const test = base.extend<{ app: ElectronApplication }>({
  app: async ({}, use) => {
    const userData = mkdtempSync(join(tmpdir(), 'termh-status-'))
    const app = await electron.launch({
      args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
      env: { ...process.env, TERMHALLA_NEEDS_INPUT_QUIET_MS: '2000' }
    })
    await use(app)
    const pid = app.process().pid
    if (pid) killTree(pid)
  }
})

async function openTerminal(win: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
}

test('a running command shows busy then returns to idle', async ({ app }) => {
  const win = await app.firstWindow()
  await openTerminal(win)
  await win.keyboard.type('Start-Sleep -Seconds 2; "done"')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-status="busy"]')).toHaveCount(1, { timeout: 5_000 })
  await expect(win.locator('[data-status="idle"]')).toHaveCount(1, { timeout: 15_000 })
})

test('a y/N prompt triggers needs-input and a tab badge', async ({ app }) => {
  test.setTimeout(40_000)
  const win = await app.firstWindow()
  await openTerminal(win)
  // print a y/N prompt and block on input
  await win.keyboard.type('Write-Host -NoNewline "Overwrite? [y/N] "; $null = [Console]::ReadLine()')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-status="needs-input"]')).toHaveCount(1, { timeout: 20_000 })
  await expect(win.locator('[data-testid^="tab-"]').first()).toContainText('🔔', { timeout: 5_000 })
  // answering clears it
  await win.keyboard.type('n')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-status="needs-input"]')).toHaveCount(0, { timeout: 10_000 })
})

test('per-terminal settings: rename + mute the status border', async ({ app }) => {
  const win = await app.firstWindow()
  await openTerminal(win)
  const gear = win.locator('[data-testid^="gear-"]').first()
  await gear.click()
  await win.getByTestId('setting-name').fill('build')
  await win.getByTestId('setting-border').uncheck()
  await win.getByTestId('settings-close').click()
  // border muted -> no tile carries the term-border class
  await expect(win.locator('.term-tile.term-border')).toHaveCount(0)
  // rename reflected in the pane title
  await expect(win.locator('.mosaic-window-title').first()).toContainText('build')
})
```

- [ ] **Step 2: Build then run the status e2e**
Run: `npm run build && npx playwright test tests/e2e/status.spec.ts`
Expected: 3 tests pass; screenshots optional.
If the busy/idle test shows the tile going `idle` *during* the `Start-Sleep` (never busy, or busy never clears), the PowerShell integration script did not load — investigate `scriptDir` resolution in `register.ts` (the script path must exist and be dot-sourced). Do NOT loosen assertions; the busy/idle test is the proof shell-integration works. The heuristic fallback alone cannot distinguish a sleeping command from idle, so this test genuinely depends on markers.

- [ ] **Step 3: Run the FULL e2e suite (status + Phase 1)**
Run: `npm run e2e`
Expected: all pass (Phase 1's 5 + these 3 = 8).

- [ ] **Step 4: Commit**
```
git add -A && git commit -m "test: e2e status — busy/idle, needs-input badge, settings rename + mute"
```

---

## Task 13: Phase 2 verification pass

- [ ] **Step 1: Full gates**
Run: `npm run typecheck && npm test && npm run build && npm run e2e`
Expected: typecheck clean; all unit tests pass (Phase 1 20 + new: alerts 3, osc133 8, needs-input 8, tracker 6, engine 2, shell-integration 3 = 50 total); build succeeds; all 8 e2e pass.

- [ ] **Step 2: Manual acceptance against the spec**
In `npm run dev`, confirm by hand:
- Run a long command in a PowerShell terminal → pulsing busy border; on completion → idle border tinted green (success) or red (failure), fading to neutral.
- A `[y/N]`/`password:` prompt → flashing needs-input border + 🔔 on the pane title + 🔔 badge on the workspace tab.
- Unfocus the window while a terminal hits needs-input → an OS notification appears; clicking it focuses the window.
- Gear popover → rename a terminal, toggle each alert channel; settings persist after Save + restart.
- A cmd terminal (no integration) still shows busy/idle via heuristics.

- [ ] **Step 3: Commit any adjustments**
```
git add -A && git commit -m "chore: phase 2 verification adjustments"
```

---

## Self-Review notes (resolved)

- **Spec coverage:** busy/idle/needs-input detection ✓ (Tasks 2–5); OSC 133 + heuristic hybrid ✓ (parser Task 2, tracker heuristics Task 4); PowerShell + bash injection, cmd heuristics ✓ (Task 6); pane border / tab badge / OS notification ✓ (Tasks 10–11, notify in Task 8/9); per-terminal config panel (rename + 4 toggles) ✓ (Task 10); persistence of alert config + schema v2 ✓ (Task 1 + existing store auto-save; v1 files still load since `alerts` is optional and migrate 1→2 is identity); needs-input conservative default (10s + curated patterns, env-overridable) ✓ (Tasks 3, 5).
- **Type consistency:** `TerminalStatus{state,lastExit,since}`, `AlertConfig` keys (`border/tabBadge/osNotification/needsInput`), `MarkerEvent{kind,exit}`, `NeedsInputConfig{enabled,quietMs,patterns,heuristicIdleMs}`, `Injection{args,env}`, and channels `CH.ptyStatus/CH.notify` are used identically across tasks. `StatusEngine` ctor `(onStatus, now?)` matches its test and `register.ts` usage. `PtyManager` ctor `(onData,onExit,engine,scriptDir)` matches `register.ts`.
- **No placeholders:** every code step is complete. The PowerShell/bash integration scripts are best-effort and always chained onto the user's prompt/rc; any failure degrades to heuristics (which the tracker implements), so status is never absent.
- **Packaging note (out of scope, flagged):** integration scripts are written to `userData/shell-integration` at runtime from in-process string constants, so there is no resource-bundling dependency — this works unpackaged (dev + e2e) and will continue to work when the app is later packaged.
```