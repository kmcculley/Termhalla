# SSH tmux Auto-Attach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an SSH favorite opt into a named tmux session that is attached-or-created on every connect (first launch and every restart).

**Architecture:** Add one optional field (`tmuxSession`) to `SshConnection`. When set, the pure `buildSshArgs` helper bakes `ssh -t … user@host tmux new -A -s <name>` into the launch args. Because SSH favorites already persist `launch.args` and the restore path re-runs them verbatim, reattach-on-restart needs no new runtime code — it rides the existing SSH launch-restore path. A checkbox + name input in the connection form writes the field.

**Tech Stack:** TypeScript, Electron, React, zustand (renderer store), vitest (unit), Playwright-for-Electron (e2e).

## Global Constraints

- **TDD.** Failing test first. Pure logic → vitest in `tests/`. UI/IPC → Playwright e2e that launches the app. Match the nearest existing test's style.
- **Path alias:** import shared code as `@shared/...`.
- **No secrets persisted.** A tmux session name is not a secret; this is consistent with the existing rule (SSH stores host/user/port + identity-file path only).
- **No schema bump.** `tmuxSession` is an optional field on `SshConnection`, which lives in `quick.json` (not the versioned workspace/app-state files). Absent = off. Existing `quick.json` entries deserialize unchanged.
- **`npm run e2e` runs against `out/`** — `npm run build` before running e2e.
- **Spec:** `docs/superpowers/specs/2026-06-18-ssh-tmux-auto-attach-design.md`.

---

## File Structure

- `src/shared/types.ts` — add `tmuxSession?: string` to `SshConnection`.
- `src/shared/quick.ts` — extend `buildSshArgs` to emit the tmux command when `tmuxSession` is set.
- `tests/shared/quick.test.ts` — new `buildSshArgs` tmux cases.
- `src/renderer/components/SshConnectionForm.tsx` — tmux checkbox + session-name input.
- `tests/e2e/ssh-quick.spec.ts` — extend with a tmux create→edit roundtrip (or a new sibling spec).
- `docs/features/ssh-favorites.md` — document the new field + behavior.

---

## Task 1: `tmuxSession` field + `buildSshArgs` tmux args

**Files:**
- Modify: `src/shared/types.ts:31-38` (`SshConnection` interface)
- Modify: `src/shared/quick.ts:3-11` (`buildSshArgs`)
- Test: `tests/shared/quick.test.ts:8-24` (extend the `buildSshArgs` describe block)

**Interfaces:**
- Consumes: `SshConnection` (existing).
- Produces: `buildSshArgs(c: SshConnection): string[]` — unchanged signature. New behavior: when `c.tmuxSession` trims/sanitizes to a non-empty string, the returned argv is `['-t', ...existing opts..., 'user@host', 'tmux', 'new', '-A', '-s', '<sanitized>']`; otherwise unchanged from today.

- [ ] **Step 1: Write the failing tests**

Add these cases inside the existing `describe('buildSshArgs', …)` block in `tests/shared/quick.test.ts` (after the existing `it('orders port before identity before target', …)` at line 23):

```typescript
  it('leaves args unchanged when tmuxSession is unset or empty', () => {
    expect(buildSshArgs({ ...base, tmuxSession: '' })).toEqual(['kev@example.com'])
    expect(buildSshArgs({ ...base, tmuxSession: '   ' })).toEqual(['kev@example.com'])
  })
  it('prepends -t and appends a tmux attach-or-create command when tmuxSession is set', () => {
    expect(buildSshArgs({ ...base, tmuxSession: 'main' }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'main'])
  })
  it('keeps -t before port/identity, host before the tmux command', () => {
    expect(buildSshArgs({ ...base, port: 2200, identityFile: 'k', tmuxSession: 'work' }))
      .toEqual(['-t', '-p', '2200', '-i', 'k', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'work'])
  })
  it('sanitizes tmux session names (tmux forbids . and :, collapse whitespace)', () => {
    expect(buildSshArgs({ ...base, tmuxSession: ' my.session:1 ' }))
      .toEqual(['-t', 'kev@example.com', 'tmux', 'new', '-A', '-s', 'my-session-1'])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- quick`
Expected: FAIL — TypeScript/assertion errors because `tmuxSession` is not a property of `SshConnection` and `buildSshArgs` does not emit tmux args.

- [ ] **Step 3: Add the field to `SshConnection`**

In `src/shared/types.ts`, change the interface (lines 31-38) to add the field:

```typescript
export interface SshConnection {
  id: string
  name: string
  host: string
  user: string
  port?: number          // default 22
  identityFile?: string  // path to a private key; optional
  tmuxSession?: string   // when set (non-empty), connect via `tmux new -A -s <name>`
}
```

- [ ] **Step 4: Implement the tmux args in `buildSshArgs`**

Replace `buildSshArgs` in `src/shared/quick.ts` (lines 3-11) with:

```typescript
/** Build the argv after the `ssh` program: `[-t] [-p PORT] [-i IDENTITY] user@host [tmux new -A -s NAME]`.
 *  When `tmuxSession` is set, force a remote PTY (-t) and run an attach-or-create tmux command so the
 *  session is reattached on reconnect/restart (the launch override is persisted and re-run verbatim). */
export function buildSshArgs(c: SshConnection): string[] {
  // tmux forbids '.' and ':' in session names; collapse those and whitespace runs to '-'.
  const session = (c.tmuxSession ?? '').trim().replace(/[.:\s]+/g, '-')
  const args: string[] = []
  if (session) args.push('-t')
  // Omit -p when the port is unset, the default (22), or an out-of-range 0.
  if (c.port && c.port !== 22) args.push('-p', String(c.port))
  if (c.identityFile && c.identityFile.length > 0) args.push('-i', c.identityFile)
  args.push(`${c.user}@${c.host}`)
  if (session) args.push('tmux', 'new', '-A', '-s', session)
  return args
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- quick`
Expected: PASS — all `buildSshArgs` cases green (existing + new).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no type errors from the new field.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/shared/quick.ts tests/shared/quick.test.ts
git commit -m "feat(ssh): tmux session field + attach-or-create args in buildSshArgs"
```

---

## Task 2: tmux checkbox + session-name input in the connection form

**Files:**
- Modify: `src/renderer/components/SshConnectionForm.tsx`
- Test: `tests/e2e/ssh-quick.spec.ts` (add a new `test(...)` block; the file already exists)

**Interfaces:**
- Consumes: `buildSshArgs` / `SshConnection.tmuxSession` (Task 1). The form's `build()` returns a `SshConnection` that now conditionally includes `tmuxSession`.
- Produces: form controls with `data-testid`s `conn-tmux` (checkbox) and `conn-tmux-session` (text input). When the checkbox is on and the name is non-empty, `build()` includes `tmuxSession`; otherwise it is omitted.

- [ ] **Step 1: Write the failing e2e test**

Append this test to `tests/e2e/ssh-quick.spec.ts` (after the existing test, before EOF). It reuses the helpers already imported at the top of that file (`killTree`, `electron`, etc.):

```typescript
test('ssh form: enabling tmux persists the session and round-trips into edit', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-tmux-'))
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, 'quick.json'), JSON.stringify({
    connections: [], recentConnections: [], favoriteDirs: [], recentDirs: []
  }), 'utf8')

  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // Create a connection with tmux enabled.
  await win.keyboard.press('Control+K')
  await win.getByTestId('palette-input').fill('new ssh')
  await win.getByTestId('palette-item-0').click()
  await expect(win.getByTestId('connection-form')).toBeVisible()
  await win.getByTestId('conn-name').fill('tmux-box')
  await win.getByTestId('conn-host').fill('example.com')
  await win.getByTestId('conn-user').fill('kev')
  // The session input is hidden until the checkbox is on.
  await expect(win.getByTestId('conn-tmux-session')).toBeHidden()
  await win.getByTestId('conn-tmux').check()
  await expect(win.getByTestId('conn-tmux-session')).toHaveValue('main') // default
  await win.getByTestId('conn-tmux-session').fill('work')
  await win.getByTestId('conn-save').click()
  await expect(win.getByTestId('connection-form')).toBeHidden()

  // Re-open the connection in the edit form: the checkbox is on and the name round-trips.
  await win.keyboard.press('Control+K')
  await win.getByTestId('palette-input').fill('tmux-box')
  await expect(win.getByTestId('palette-item-0')).toContainText('tmux-box')
  await win.getByTestId('palette-item-0').getByTitle('Edit').click()
  await expect(win.getByTestId('connection-form')).toBeVisible()
  await expect(win.getByTestId('conn-tmux')).toBeChecked()
  await expect(win.getByTestId('conn-tmux-session')).toHaveValue('work')

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
```

- [ ] **Step 2: Build, then run the e2e to verify it fails**

Run: `npm run build && npm run e2e -- ssh-quick`
Expected: FAIL — `conn-tmux` / `conn-tmux-session` testids do not exist yet (locator timeout).

- [ ] **Step 3: Add tmux state to the form**

In `src/renderer/components/SshConnectionForm.tsx`, after the `identityFile` state (line 20), add:

```typescript
  const [tmux, setTmux] = useState(!!editing?.tmuxSession)
  const [tmuxSession, setTmuxSession] = useState(editing?.tmuxSession ?? 'main')
```

- [ ] **Step 4: Include `tmuxSession` in `build()`**

In the same file, change `build()` (lines 29-36) to spread the field conditionally, mirroring `port`/`identityFile`:

```typescript
  const build = (): SshConnection => ({
    id: editing?.id ?? uuid(),
    name: name.trim() || `${user.trim()}@${host.trim()}`,
    host: host.trim(),
    user: user.trim(),
    ...(port.trim() ? { port: Number(port) } : {}),
    ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {}),
    ...(tmux && tmuxSession.trim() ? { tmuxSession: tmuxSession.trim() } : {})
  })
```

- [ ] **Step 5: Render the checkbox + name input**

In the same file, insert this block after the Identity-file `field(...)` call and before the buttons `<div>` (i.e. after line 81, before line 82):

```tsx
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input data-testid="conn-tmux" type="checkbox" checked={tmux}
            onChange={e => setTmux(e.target.checked)} />
          <span style={{ color: 'var(--fg-dim, #aaa)' }}>Open in tmux session (attach or create on connect)</span>
        </label>
        {tmux && field('tmux session name', <input data-testid="conn-tmux-session" value={tmuxSession}
          onChange={e => setTmuxSession(e.target.value)} style={inputStyle} />)}
```

- [ ] **Step 6: Build, then run the e2e to verify it passes**

Run: `npm run build && npm run e2e -- ssh-quick`
Expected: PASS — both tests in the file green (the original palette test and the new tmux round-trip).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/SshConnectionForm.tsx tests/e2e/ssh-quick.spec.ts
git commit -m "feat(ssh): tmux session checkbox + name in connection form"
```

---

## Task 3: Document the feature

**Files:**
- Modify: `docs/features/ssh-favorites.md`
- Modify: `CHANGELOG.md`

**Interfaces:** None (docs only).

- [ ] **Step 1: Update the feature doc**

In `docs/features/ssh-favorites.md`, add a short subsection describing the tmux option. Use this content (adapt headings to match the doc's existing style):

```markdown
## tmux auto-attach

A favorite can opt into a named tmux session (`tmuxSession` on `SshConnection`). When set,
`buildSshArgs` emits `ssh -t … user@host tmux new -A -s <name>`: `-t` forces a remote PTY and
`tmux new -A -s` attaches the session if it exists or creates it otherwise. Because the launch
override (`{command:'ssh', args}`) is persisted per-pane and re-run verbatim on restart, the
session is reattached automatically on reconnect and on app restart — no extra runtime logic.

Session names are sanitized at arg-build time (tmux forbids `.` and `:`; whitespace and those
characters collapse to `-`). Detaching inside tmux (Ctrl-b d) returns from the remote command,
so ssh exits and the pane closes; the remote session lives on and relaunching the favorite (or
restarting the app) reattaches it.
```

- [ ] **Step 2: Update the changelog**

Add an entry under the appropriate unreleased/next section of `CHANGELOG.md`:

```markdown
- SSH favorites can open in a named tmux session (`tmux new -A -s <name>`), attached-or-created on
  connect and reattached automatically on reconnect/restart.
```

- [ ] **Step 3: Commit**

```bash
git add docs/features/ssh-favorites.md CHANGELOG.md
git commit -m "docs(ssh): document tmux auto-attach for favorites"
```

---

## Self-Review

**1. Spec coverage:**
- Data model (`tmuxSession?: string` on `SshConnection`) → Task 1, Step 3. ✓
- `buildSshArgs` emits `-t` + `tmux new -A -s` with correct ordering + sanitization → Task 1, Steps 1/4. ✓
- No migration / schema bump (optional field in `quick.json`) → Global Constraints; field is optional, no other code reads it as required. ✓
- Form checkbox + name input, default `main`, conditional `build()` spread, edit round-trip → Task 2. ✓
- "No changes needed" for `launchConnection`/restore path → confirmed: `launchConnection` already calls `buildSshArgs(conn)`; nothing else touched. ✓
- Behavior/tradeoffs (detach closes pane; opt-in) → documented in Task 3. ✓
- Testing: unit `buildSshArgs` cases + e2e form round-trip; remote attach not e2e-able without a live host → Task 1 + Task 2 match the spec's testing section. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows complete code. ✓

**3. Type consistency:** `tmuxSession` is the single name used in the type (Task 1), `buildSshArgs` (Task 1), and the form `build()` (Task 2). Testids `conn-tmux` / `conn-tmux-session` are consistent between the form (Task 2 Steps 3/5) and the e2e (Task 2 Step 1). `buildSshArgs` signature is unchanged, so existing callers are unaffected. ✓
