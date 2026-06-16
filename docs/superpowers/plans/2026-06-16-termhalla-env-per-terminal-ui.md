# Per-Terminal Env Var Editing UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Let the user edit a terminal's *own* env vars (not just globals) from the env manager, scoped to that pane.

**Architecture:** Extend the existing `EnvManager` modal with an optional pane-scoped mode (`wsId`/`paneId` props). When scoped, it shows a "This terminal" section in addition to "Global", reading/writing `data.terminals[envId]` via the existing `envSetTerminal`/`envRemoveTerminal` IPC. The pane's `config.envId` is assigned lazily (a `uuid()`) on the first per-terminal var via `updatePaneConfig`. A per-pane `🔑` toolbar button (mirroring the per-pane `🎨` theme button) opens it scoped.

**Builds on:** the env-vars sub-project (`docs/features/env-vars.md`). The data model (`TerminalConfig.envId`, `envFor(envId)` injection, `env:setTerminal`/`env:removeTerminal`) already exists and is exercised at spawn.

**Spawn-timing semantic (load-bearing):** env vars are injected when a terminal is *spawned*. A per-terminal var added to an already-running terminal therefore applies when that pane is next spawned (workspace restore re-spawns with the persisted `envId`) **while the vault is unlocked** — not retroactively to the live shell. This is the same rule globals already follow; document it, don't fight it.

---

## Task 1: EnvManager scoped mode + per-pane 🔑 button

**Files:** Modify `src/renderer/components/EnvManager.tsx`, `src/renderer/components/WorkspaceView.tsx`.

- [ ] **Step 1: EnvManager props + envId.** Change the signature to
  `export function EnvManager({ onClose, wsId, paneId }: { onClose: () => void; wsId?: string; paneId?: string })`.
  Inside, add (keep the existing global state/logic intact):
  - `import { v4 as uuid } from 'uuid'`.
  - Read the pane's current envId live from the store:
    ```ts
    const updatePaneConfig = useStore(s => s.updatePaneConfig)
    const paneConfig = useStore(s => (wsId && paneId) ? s.workspaces[wsId]?.panes[paneId]?.config : undefined)
    const envId = (paneConfig && paneConfig.kind === 'terminal') ? paneConfig.envId : undefined
    const scoped = !!(wsId && paneId)
    ```
  - Add local add-row state for the terminal section: `const [tName, setTName] = useState('')`, `const [tValue, setTValue] = useState('')`.
  - `addTerminalVar`:
    ```ts
    const addTerminalVar = (): void => {
      if (!tName.trim() || !wsId || !paneId) return
      let id = envId
      if (!id) { id = uuid(); updatePaneConfig(wsId, paneId, { envId: id }) }
      api.envSetTerminal(id, tName, tValue)
      setTName(''); setTValue(''); void refresh()
    }
    ```
  - Remove the stale top-of-file NOTE comment about per-terminal editing being deferred (it's now implemented). Replace it with a one-line comment describing scoped mode.

- [ ] **Step 2: EnvManager — render the "This terminal" section.** Inside the `env.unlocked` block, AFTER the Global add-row and BEFORE the Lock/Close footer, render (only when `scoped`):
  ```tsx
  {scoped && (
    <>
      <div data-testid="env-term-section" style={{ fontWeight: 600, borderTop: '1px solid var(--border, #444)', paddingTop: 8 }}>This terminal</div>
      {Object.entries((envId && data?.terminals[envId]) ? data!.terminals[envId] : {}).map(([name, value]) => (
        <div key={name} data-testid={`env-term-row-${name}`} style={row}>
          <span style={{ flex: '0 0 140px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          <input type="password" value={value} readOnly style={{ flex: 1 }} />
          <button data-testid={`env-term-del-${name}`} onClick={() => { if (envId) { api.envRemoveTerminal(envId, name); void refresh() } }}>×</button>
        </div>
      ))}
      <div style={row}>
        <input data-testid="env-term-name" placeholder="NAME" value={tName}
          onChange={e => setTName(e.target.value)} style={{ flex: '0 0 140px', fontFamily: 'monospace' }} />
        <input data-testid="env-term-value" placeholder="value" value={tValue}
          onChange={e => setTValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addTerminalVar() }} style={{ flex: 1 }} />
        <button data-testid="env-term-add" disabled={!tName.trim()} onClick={addTerminalVar}>Add</button>
      </div>
      <div style={{ opacity: 0.6, fontSize: '0.85em' }}>Applies the next time this terminal is spawned (e.g. after reopening the workspace) while the vault is unlocked.</div>
    </>
  )}
  ```
  Reuse the existing `row` const and the `EnvRow`/global-section markup as-is. (The terminal rows are inline rather than reusing `EnvRow` so the per-row reveal toggle isn't required; a simple password input is fine. If you prefer, factor a shared row component — optional.)

- [ ] **Step 3: WorkspaceView — per-pane 🔑 button + scoped modal.** In `src/renderer/components/WorkspaceView.tsx`:
  - `import { EnvManager } from './EnvManager'`.
  - Add state near the other per-pane menu state: `const [envFor, setEnvFor] = useState<string | null>(null)`.
  - In the `termCfg` toolbar-controls array (next to the `theme` button), add:
    ```tsx
    <button key="env" type="button" data-testid={`env-chip-${paneId}`} title="Environment variables"
      style={{ color: termCfg.envId ? 'var(--accent, #4ea1ff)' : undefined }}
      onClick={() => setEnvFor(envFor === paneId ? null : paneId)}>🔑</button>,
    ```
  - Near the `{themeFor === paneId && <ThemeEditor .../>}` render, add:
    ```tsx
    {envFor === paneId && <EnvManager wsId={ws.id} paneId={paneId} onClose={() => setEnvFor(null)} />}
    ```

- [ ] **Step 4: Typecheck + build, then commit.**
  ```bash
  npm run typecheck
  npm run build
  git add src/renderer/components/EnvManager.tsx src/renderer/components/WorkspaceView.tsx
  git commit -m "feat(env): per-terminal var editing (scoped EnvManager + per-pane 🔑)"
  ```

---

## Task 2: e2e + docs

**Files:** Create `tests/e2e/env-per-terminal.spec.ts`; modify `docs/features/env-vars.md`, `CHANGELOG.md`.

- [ ] **Step 1: e2e.** Copy launch boilerplate from `tests/e2e/env-vars.spec.ts` (killTree, temp user-data-dir, shell-picker → `powershell`, `add-first-terminal`). Flow ("a per-terminal var is written under the pane and persists"):
  1. Launch; create the vault (`env-button` → `env-passphrase`=`pw` → `env-create`), then close the global manager (Close button).
  2. Add a terminal (powershell). Wait for `[data-testid^="terminal-"]`.
  3. Click the pane's `env-chip-<paneId>` — derive the paneId from the terminal testid, OR just click `[data-testid^="env-chip-"]` (first). Expect `env-manager` visible and `env-term-section` visible (vault is unlocked in-session).
  4. Fill `env-term-name`=`BAR`, `env-term-value`=`baz9911`, click `env-term-add`. Expect `env-term-row-BAR` visible.
  5. Close the manager; reopen the same pane's `env-chip`; expect `env-term-row-BAR` still visible (proves it persisted into the vault under the pane's assigned envId and is re-read via `env:get`).
  6. Teardown via killTree.
  Use `test.setTimeout(60_000)`. (End-to-end *injection* of per-terminal vars is covered by the `env-vault` unit test's `envFor('t1')` merge assertion; this e2e proves the UI writes + persists correctly.)

- [ ] **Step 2: Full gate.** `npm run typecheck`, `npm test`, then build + `npx playwright test tests/e2e/env-per-terminal.spec.ts`, then the full `npm run e2e` → green.

- [ ] **Step 3: Docs.** In `docs/features/env-vars.md`: update "What it does" / remove the per-terminal item from "Deferred" (it's shipped); add a short "Per-terminal variables" subsection covering the per-pane `🔑` button, lazy `envId` assignment, and the spawn-timing semantic. In `CHANGELOG.md` under `[Unreleased] → Changed` (or Added), note per-terminal env var editing. Commit:
  ```bash
  git add tests/e2e/env-per-terminal.spec.ts docs/features/env-vars.md CHANGELOG.md
  git commit -m "test(env): e2e per-terminal var write+persist; docs"
  ```

---

## Self-review notes
- Coverage: scoped EnvManager + per-pane button (T1), e2e + docs (T2).
- Security unchanged: per-terminal section writes only via `envSetTerminal`; workspace JSON still stores only `envId`; values stay in main memory while unlocked.
- The global `🔑` (WorkspaceTabs) still opens EnvManager with no paneId → global-only (no behavior change).
- Known: a per-terminal var applies on next spawn of that pane (workspace restore) while unlocked — documented, consistent with globals.
