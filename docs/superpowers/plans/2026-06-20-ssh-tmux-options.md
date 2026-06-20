# SSH tmux options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an SSH favorite carry a small set of common tmux options (mouse, true color, faster Esc, scrollback, OSC 52 clipboard) that Termhalla applies via server-global `set -g` on every connect, fixing wheel-scroll inside full-screen TUIs (Claude Code) under tmux.

**Architecture:** A pure helper in `src/shared/quick.ts` turns a `TmuxOptions` object into tmux `set -g` argv fragments and appends them (chained with `\;` separator tokens) after the existing `tmux new -A -s NAME` in `buildSshArgs`. The SSH connection form gains controls (gated on the tmux checkbox) that read/write `SshConnection.tmuxOptions`. No main-process change — `launchConnection` already calls `buildSshArgs(conn)`.

**Tech Stack:** TypeScript (strict), React 18, zustand, vitest (unit), Playwright-for-Electron (e2e).

## Global Constraints

- **TDD** — failing test first, then minimal implementation.
- Pure logic lives in `src/shared/` and is unit-tested without Electron.
- Path alias: import shared code as `@shared/...`.
- No secrets persisted — `tmuxOptions` carries only display/config booleans + a number.
- `tmuxOptions` is an additive **optional** field; an undefined field resolves to its default
  (`mouse/trueColor/fastEsc` ON, `clipboard` OFF, `historyLimit` omitted). No schema migration.
- The `,*:Tc` value MUST be single-quoted in the argv token so the remote shell does not glob `*`.
- The command separator is the literal token `\;` (JS string `'\\;'`).

---

### Task 1: Data model + pure command generation

**Files:**
- Modify: `src/shared/types.ts` (add `TmuxOptions`, add `tmuxOptions?` to `SshConnection` near line 31-39)
- Modify: `src/shared/quick.ts` (add `tmuxOptionCommands`, extend `buildSshArgs` near line 6-17)
- Test: `tests/shared/quick.test.ts` (extend the existing `buildSshArgs` suite, lines 8-52)

**Interfaces:**
- Produces: `interface TmuxOptions { mouse?: boolean; trueColor?: boolean; fastEsc?: boolean; historyLimit?: number; clipboard?: boolean }`
- Produces: `tmuxOptionCommands(o?: TmuxOptions): string[][]` — ordered tmux `set` commands (each an argv fragment), defaults applied.
- Produces: `buildSshArgs(c: SshConnection): string[]` — unchanged signature; now appends option tokens after the tmux attach command.

- [ ] **Step 1: Add the data model to `src/shared/types.ts`**

Replace the `SshConnection` interface (lines 30-39) with:

```ts
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
```

- [ ] **Step 2: Write the failing unit tests in `tests/shared/quick.test.ts`**

Change the import on line 2 to include `tmuxOptionCommands`:

```ts
import { buildSshArgs, tmuxOptionCommands, pushRecent, nextRecentDirs, buildPaletteItems, filterPaletteItems } from '@shared/quick'
```

Add a shared fixture just above the `describe('buildSshArgs', ...)` block (after line 6):

```ts
// The tokens appended for the on-by-default options (mouse + faster Esc + true color).
const DEFAULT_TMUX = [
  '\\;', 'set', '-g', 'mouse', 'on',
  '\\;', 'set', '-g', 'escape-time', '10',
  '\\;', 'set', '-g', 'default-terminal', 'tmux-256color',
  '\\;', 'set', '-ga', 'terminal-overrides', "',*:Tc'"
]
```

Replace the four existing tmux assertions (the `it(...)` blocks currently at lines 28-45) with their default-options-aware versions:

```ts
  it('prepends -t and appends tmux attach + on-by-default options when tmuxSession is set', () => {
    expect(buildSshArgs({ ...base, tmuxSession: 'main' }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'main', ...DEFAULT_TMUX])
  })
  it('keeps -t before port/identity, host before the tmux command', () => {
    expect(buildSshArgs({ ...base, port: 2200, identityFile: 'k', tmuxSession: 'work' }))
      .toEqual(['-t', '-p', '2200', '-i', 'k', 'kev@example.com',
        'tmux', 'new', '-A', '-s', 'work', ...DEFAULT_TMUX])
  })
  it('sanitizes tmux session names (tmux forbids . and :, collapse whitespace)', () => {
    expect(buildSshArgs({ ...base, tmuxSession: ' my.session:1 ' }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'my-session-1', ...DEFAULT_TMUX])
  })
  it('strips a leading dash produced by sanitization (tmux would treat it as a flag)', () => {
    expect(buildSshArgs({ ...base, tmuxSession: '.session' }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'session', ...DEFAULT_TMUX])
    expect(buildSshArgs({ ...base, tmuxSession: ' :foo' }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'foo', ...DEFAULT_TMUX])
  })
```

Add these new tests just before the closing `})` of the `buildSshArgs` describe (after the current line 51):

```ts
  it('mouse off drops only the mouse command; other defaults remain', () => {
    expect(buildSshArgs({ ...base, tmuxSession: 'main', tmuxOptions: { mouse: false } }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'main',
        '\\;', 'set', '-g', 'escape-time', '10',
        '\\;', 'set', '-g', 'default-terminal', 'tmux-256color',
        '\\;', 'set', '-ga', 'terminal-overrides', "',*:Tc'"])
  })
  it('all options off appends only the bare attach-or-create command', () => {
    expect(buildSshArgs({ ...base, tmuxSession: 'main',
      tmuxOptions: { mouse: false, trueColor: false, fastEsc: false, clipboard: false } }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'main'])
  })
  it('emits history-limit only for a positive number', () => {
    const off = { mouse: false, trueColor: false, fastEsc: false }
    expect(buildSshArgs({ ...base, tmuxSession: 'main', tmuxOptions: { ...off, historyLimit: 50000 } }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'main',
        '\\;', 'set', '-g', 'history-limit', '50000'])
    expect(buildSshArgs({ ...base, tmuxSession: 'main', tmuxOptions: { ...off, historyLimit: 0 } }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'main'])
  })
  it('clipboard on appends set-clipboard', () => {
    expect(buildSshArgs({ ...base, tmuxSession: 'main',
      tmuxOptions: { mouse: false, trueColor: false, fastEsc: false, clipboard: true } }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'main',
        '\\;', 'set', '-g', 'set-clipboard', 'on'])
  })
  it('no tmux session ignores tmuxOptions entirely', () => {
    expect(buildSshArgs({ ...base, tmuxOptions: { mouse: true } })).toEqual(['kev@example.com'])
  })

  describe('tmuxOptionCommands', () => {
    it('applies on-by-default options for empty input', () => {
      expect(tmuxOptionCommands()).toEqual([
        ['set', '-g', 'mouse', 'on'],
        ['set', '-g', 'escape-time', '10'],
        ['set', '-g', 'default-terminal', 'tmux-256color'],
        ['set', '-ga', 'terminal-overrides', "',*:Tc'"]
      ])
    })
    it('returns an empty list when every option is off', () => {
      expect(tmuxOptionCommands({ mouse: false, trueColor: false, fastEsc: false, clipboard: false }))
        .toEqual([])
    })
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- quick`
Expected: FAIL — `tmuxOptionCommands` is not exported (import error / not a function), and the updated `buildSshArgs` assertions don't match (no option tokens appended yet).

- [ ] **Step 4: Implement in `src/shared/quick.ts`**

Change the import on line 1 to bring in `TmuxOptions`:

```ts
import type { SshConnection, QuickStore, TmuxOptions } from './types'
```

Add, immediately above `buildSshArgs` (before line 3's doc comment), the separator constant and the command builder:

```ts
/** Backslash-semicolon: the remote shell turns `\;` into a literal `;`, which tmux reads as a
 *  command separator (a bare `;` would be consumed by the remote shell instead). */
const TMUX_SEP = '\\;'

/** The tmux `set -g` commands (each an argv fragment) for the given options, with defaults applied.
 *  Order is fixed for deterministic argv. `set -g` is server-global so it overrides the remote
 *  ~/.tmux.conf and applies to the attached session. */
export function tmuxOptionCommands(o: TmuxOptions = {}): string[][] {
  const cmds: string[][] = []
  if (o.mouse ?? true) cmds.push(['set', '-g', 'mouse', 'on'])
  if (o.fastEsc ?? true) cmds.push(['set', '-g', 'escape-time', '10'])
  if (o.trueColor ?? true) {
    cmds.push(['set', '-g', 'default-terminal', 'tmux-256color'])
    // single-quoted so the remote shell does not glob the '*'
    cmds.push(['set', '-ga', 'terminal-overrides', "',*:Tc'"])
  }
  if (o.historyLimit && o.historyLimit > 0) {
    cmds.push(['set', '-g', 'history-limit', String(Math.floor(o.historyLimit))])
  }
  if (o.clipboard ?? false) cmds.push(['set', '-g', 'set-clipboard', 'on'])
  return cmds
}
```

In `buildSshArgs`, replace the single tmux-append line (currently line 15) with the attach command plus the option tokens:

```ts
  if (session) {
    args.push('tmux', 'new', '-A', '-s', session)
    for (const cmd of tmuxOptionCommands(c.tmuxOptions)) args.push(TMUX_SEP, ...cmd)
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- quick`
Expected: PASS (all `buildSshArgs` and `tmuxOptionCommands` tests green).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/shared/quick.ts tests/shared/quick.test.ts
git commit -m "feat(ssh): tmux set -g options in buildSshArgs"
```

---

### Task 2: SSH form controls + e2e

**Files:**
- Modify: `src/renderer/components/SshConnectionForm.tsx` (state near line 21-22, `build()` near line 38, JSX near line 90-91)
- Test: `tests/e2e/ssh-quick.spec.ts` (extend the existing tmux test, lines 62-102)

**Interfaces:**
- Consumes: `SshConnection.tmuxOptions` and `TmuxOptions` from Task 1.
- Consumes (unchanged): `buildSshArgs` is already called by `launchConnection` in `src/renderer/store/quick-slice.ts:78`, so persisting `tmuxOptions` is sufficient — no store change.

- [ ] **Step 1: Write the failing e2e in `tests/e2e/ssh-quick.spec.ts`**

In the test `'ssh form: enabling tmux persists the session and round-trips into edit'`, insert option assertions after the `conn-tmux` checkbox is checked. Replace the block currently at lines 86-89:

```ts
  await win.getByTestId('conn-tmux').check()
  await expect(win.getByTestId('conn-tmux-session')).toHaveValue('main') // default
  await win.getByTestId('conn-tmux-session').fill('work')
  await win.getByTestId('conn-save').click()
```

with:

```ts
  await win.getByTestId('conn-tmux').check()
  await expect(win.getByTestId('conn-tmux-session')).toHaveValue('main') // default
  await win.getByTestId('conn-tmux-session').fill('work')
  // tmux options appear with the on-by-default boxes pre-checked.
  await expect(win.getByTestId('conn-tmux-options')).toBeVisible()
  await expect(win.getByTestId('conn-tmux-mouse')).toBeChecked()
  await expect(win.getByTestId('conn-tmux-truecolor')).toBeChecked()
  await expect(win.getByTestId('conn-tmux-esc')).toBeChecked()
  await expect(win.getByTestId('conn-tmux-clipboard')).not.toBeChecked()
  // Opt out of mouse and set a scrollback limit, to verify they persist.
  await win.getByTestId('conn-tmux-mouse').uncheck()
  await win.getByTestId('conn-tmux-history').fill('50000')
  await win.getByTestId('conn-save').click()
```

Then add assertions after the existing edit-form round-trip checks (after line 99, `conn-tmux-session` has value `work`):

```ts
  await expect(win.getByTestId('conn-tmux-mouse')).not.toBeChecked()
  await expect(win.getByTestId('conn-tmux-truecolor')).toBeChecked()
  await expect(win.getByTestId('conn-tmux-history')).toHaveValue('50000')
```

- [ ] **Step 2: Build and run the e2e to verify it fails**

Run: `npm run build && npm run e2e -- ssh-quick`
Expected: FAIL — `conn-tmux-options` / `conn-tmux-mouse` testids don't exist yet (timeout waiting for visible).

- [ ] **Step 3: Add form state in `src/renderer/components/SshConnectionForm.tsx`**

After line 22 (`const [tmuxSession, setTmuxSession] = ...`), add:

```ts
  const o0 = editing?.tmuxOptions
  const [tmuxMouse, setTmuxMouse] = useState(o0?.mouse ?? true)
  const [tmuxTrueColor, setTmuxTrueColor] = useState(o0?.trueColor ?? true)
  const [tmuxEsc, setTmuxEsc] = useState(o0?.fastEsc ?? true)
  const [tmuxClipboard, setTmuxClipboard] = useState(o0?.clipboard ?? false)
  const [tmuxHistory, setTmuxHistory] = useState(o0?.historyLimit ? String(o0.historyLimit) : '')
```

- [ ] **Step 4: Persist the options in `build()`**

Replace the tmux spread on line 38:

```ts
    ...(tmux && tmuxSession.trim() ? { tmuxSession: tmuxSession.trim() } : {})
```

with:

```ts
    ...(tmux && tmuxSession.trim() ? {
      tmuxSession: tmuxSession.trim(),
      tmuxOptions: {
        mouse: tmuxMouse, trueColor: tmuxTrueColor, fastEsc: tmuxEsc, clipboard: tmuxClipboard,
        ...(tmuxHistory.trim() ? { historyLimit: Number(tmuxHistory) } : {})
      }
    } : {})
```

- [ ] **Step 5: Render the option controls**

Replace the tmux session-name line (lines 90-91):

```tsx
        {tmux && field('tmux session name', <input data-testid="conn-tmux-session" value={tmuxSession}
          onChange={e => setTmuxSession(e.target.value)} style={inputStyle} />)}
```

with the session field plus the gated options block:

```tsx
        {tmux && field('tmux session name', <input data-testid="conn-tmux-session" value={tmuxSession}
          onChange={e => setTmuxSession(e.target.value)} style={inputStyle} />)}
        {tmux && (
          <div data-testid="conn-tmux-options"
            style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 18, fontSize: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              title="Wheel-scroll panes and apps like Claude Code; click to select/resize panes. Fixes 'scrolling does nothing'.">
              <input data-testid="conn-tmux-mouse" type="checkbox" checked={tmuxMouse}
                onChange={e => setTmuxMouse(e.target.checked)} />
              <span style={{ color: 'var(--fg-dim, #aaa)' }}>Mouse mode (scroll &amp; click)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              title="Full 24-bit color in TUIs like Claude Code and vim.">
              <input data-testid="conn-tmux-truecolor" type="checkbox" checked={tmuxTrueColor}
                onChange={e => setTmuxTrueColor(e.target.checked)} />
              <span style={{ color: 'var(--fg-dim, #aaa)' }}>True color (24-bit)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              title="Removes the laggy delay after pressing Esc in vim and other TUIs.">
              <input data-testid="conn-tmux-esc" type="checkbox" checked={tmuxEsc}
                onChange={e => setTmuxEsc(e.target.checked)} />
              <span style={{ color: 'var(--fg-dim, #aaa)' }}>Faster Esc</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              title="Let remote programs copy into your local clipboard (OSC 52).">
              <input data-testid="conn-tmux-clipboard" type="checkbox" checked={tmuxClipboard}
                onChange={e => setTmuxClipboard(e.target.checked)} />
              <span style={{ color: 'var(--fg-dim, #aaa)' }}>System clipboard (OSC 52)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              title="How many lines of scrollback tmux keeps per pane. Blank = leave at the remote default.">
              <span style={{ color: 'var(--fg-dim, #aaa)' }}>Scrollback lines</span>
              <input data-testid="conn-tmux-history" value={tmuxHistory} inputMode="numeric" placeholder="default"
                onChange={e => setTmuxHistory(e.target.value.replace(/[^0-9]/g, ''))}
                style={{ ...inputStyle, width: 90 }} />
            </label>
          </div>
        )}
```

- [ ] **Step 6: Typecheck, build, run the e2e to verify it passes**

Run: `npm run typecheck && npm run build && npm run e2e -- ssh-quick`
Expected: PASS (options visible, defaults correct, mouse-off + scrollback round-trip through edit).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/SshConnectionForm.tsx tests/e2e/ssh-quick.spec.ts
git commit -m "feat(ssh): tmux option controls in the connection form"
```

---

### Task 3: Docs

**Files:**
- Modify: `docs/features/ssh-favorites.md` (document the tmux options)
- Modify: `CHANGELOG.md` (add an entry)

- [ ] **Step 1: Document the feature in `docs/features/ssh-favorites.md`**

Add a subsection describing the tmux options: that enabling a tmux session reveals Mouse / True color / Faster Esc / System clipboard checkboxes and a Scrollback field; that the three are on by default (so existing favorites get mouse-on automatically); that they apply via server-global `set -g` on connect, overriding the remote `.tmux.conf`; and that mouse mode is what makes wheel-scroll work inside full-screen TUIs like Claude Code. Reference `buildSshArgs` / `tmuxOptionCommands` in `src/shared/quick.ts`.

- [ ] **Step 2: Add a CHANGELOG entry**

Under the current unreleased/next section, add:

```markdown
- SSH favorites: configurable tmux options (mouse, true color, faster Esc, scrollback,
  OSC 52 clipboard) applied via `set -g` on connect. Mouse mode is on by default, fixing
  wheel-scroll inside full-screen TUIs (e.g. Claude Code) under tmux.
```

- [ ] **Step 3: Commit**

```bash
git add docs/features/ssh-favorites.md CHANGELOG.md
git commit -m "docs(ssh): document tmux options"
```

---

## Self-Review

**Spec coverage:**
- Option set (5 options, defaults) → Task 1 (`tmuxOptionCommands`) + Task 2 (controls). ✓
- Data model `tmuxOptions` + backward-compat `?? default` → Task 1 Step 1/4, covered by the "undefined applies defaults" and `tmuxOptionCommands()` tests. ✓
- Command generation: `\;` separator, `new-session` first, single-quoted `,*:Tc`, `set -g` global → Task 1 Step 4 + tests. ✓
- `history-limit` only when set; clipboard off by default → Task 1 tests. ✓
- UI gated on tmux checkbox, tooltips, testids, default resolution from `editing` → Task 2. ✓
- Tests: unit extends `quick.test.ts`; e2e extends `ssh-quick.spec.ts` (spec said `ssh-favorites.spec.ts`, but that file does not exist — the real SSH e2e is `ssh-quick.spec.ts`). Remote tmux behavior not e2e'd. ✓
- Docs → Task 3. ✓

**Placeholder scan:** none — every step shows concrete code/commands.

**Type consistency:** `TmuxOptions` field names (`mouse`, `trueColor`, `fastEsc`, `historyLimit`, `clipboard`) are identical across types.ts, `tmuxOptionCommands`, the form state, and `build()`. `tmuxOptionCommands` returns `string[][]`; `buildSshArgs` flattens with `TMUX_SEP`. e2e testids (`conn-tmux-options/-mouse/-truecolor/-esc/-clipboard/-history`) match the JSX in Task 2 Step 5.
