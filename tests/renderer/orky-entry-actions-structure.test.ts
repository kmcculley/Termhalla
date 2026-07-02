// FROZEN structural suite — feature 0008-queue-answer-resume-actions (phase 4).
// The vitest harness is node-env with no jsdom (vitest.config.ts), so the shared action layer's
// DOM/dispatch contract is pinned the repo's established way (0004/0006/0012 precedent):
// source-scan tests over literal, greppable source text — testids, api-call placement, imports,
// the pointer-isolation guard — plus repo-level scope greps. The full rendered behavior is
// asserted end-to-end in tests/e2e/orky-queue-actions.spec.ts (TEST-608..612).
//
// Chosen frozen contracts this suite freezes (implementers MUST keep every pinned literal greppable):
//   - src/renderer/components/orky-entry-actions.tsx — the ONLY api.orky* dispatch home for
//     resolveEscalation/recordHumanGate/driveStatus (REQ-001/REQ-011), exporting
//     useOrkyEntryActions + OrkyEntryActions over the OrkyEntryTarget identity;
//   - src/renderer/components/orky-entry-actions-core.ts — its api-free pure core (behaviorally
//     frozen in orky-entry-actions-core.test.ts): the shared single-flight registry, escalation
//     binding, request builders and the honesty classifier live THERE, so every user-facing
//     failure/success copy has one source of truth;
//   - every api.orky* call and the resume commitPane call sit inside event-handler functions,
//     NEVER a useEffect body (REQ-006; CONV-033 — the structural pin that makes the StrictMode
//     double-dispatch class impossible; no harness in this repo runs React's development build).
//
// Runs RED today: neither src/renderer/components/orky-entry-actions.tsx nor
// src/renderer/components/orky-entry-actions-core.ts exists yet (readFileSync throws), and
// DecisionQueuePanel.tsx mounts no OrkyEntryActions.
//
// [AMENDED at the ESC-001 tests LOOPBACK (review → tests), 2026-07-02 — CONV-019 supersessions]:
//   TEST-604 (FINDING-008) — the REQ-014 composition moves behind a NARROW store action:
//     launchTerminalAt(cwd, launch) replaces the hook's raw commitPane call, and raw commitPane
//     comes OFF the public State surface (encapsulation pinned by the new TEST-619 in
//     orky-entry-actions-loopback.test.ts). Intent preserved: the same terminal/claude/
//     '/orky:resume'/cwd composition, now pinned across the hook (argv + title + gesture-time
//     getState) AND the store action (kind/shell/workspace-less fallback/INTERNAL commitPane),
//     still copy-honest.
//   TEST-605 (FINDING-012, the contract blocker) — the original pin covered ONLY the detached
//     FAILURE toast; REQ-010's normative text ("the settled outcome MUST still be reported through
//     the store-level toast chokepoint (pushToast) … No outcome is ever silently swallowed") also
//     requires a detached SUCCESS through the same chokepoint (default suppressible kind —
//     mirroring F12, OrkyCaptureModal.tsx:106-108). The amendment ADDS the success-channel pin;
//     every original assertion is retained.
//   Every other TEST id in this file is byte-unchanged.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')
const ACTIONS = 'src/renderer/components/orky-entry-actions.tsx'
const CORE = 'src/renderer/components/orky-entry-actions-core.ts'
const actions = () => read(ACTIONS)
const core = () => read(CORE)
const panel = () => read('src/renderer/components/DecisionQueuePanel.tsx')

/** Balanced-paren spans of every useEffect(...) call (the 0012 TEST-489 technique). */
function useEffectSpans(src: string): string[] {
  const spans: string[] = []
  let i = src.indexOf('useEffect(')
  while (i !== -1) {
    let depth = 0
    let j = i + 'useEffect'.length
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++
      else if (src[j] === ')') { depth--; if (depth === 0) break }
    }
    spans.push(src.slice(i, j + 1))
    i = src.indexOf('useEffect(', j)
  }
  return spans
}

/** Every `catch (…) { … }` / `catch { … }` block body (the 0012 TEST-521 technique). */
function catchBlocks(src: string): string[] {
  const out: string[] = []
  const re = /catch\s*(\([^)]*\))?\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 0
    for (let i = m.index + m[0].length - 1; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { out.push(src.slice(m.index, i + 1)); break } }
    }
  }
  return out
}

/** A window of source text around the first occurrence of `needle`. */
function around(src: string, needle: string, before = 400, after = 400): string {
  const at = src.indexOf(needle)
  expect(at, `${needle} must exist`).toBeGreaterThanOrEqual(0)
  return src.slice(Math.max(0, at - before), at + needle.length + after)
}

/** Recursively collect every file under a dir. */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

// The full pinned testid namespace (02-spec.md Resolved decision #4).
const DQ_ACTION_TESTIDS = [
  'dq-action-answer', 'dq-action-preview', 'dq-action-resume', 'dq-action-answer-target',
  'dq-action-answer-input', 'dq-action-answer-submit', 'dq-action-verdict-pass',
  'dq-action-verdict-fail', 'dq-action-evidence', 'dq-action-pending', 'dq-action-result',
  'dq-action-error'
]

describe('scope — Orky writes EXCLUSIVELY through F7\'s existing bridges, in ONE module (REQ-001)', () => {
  it('TEST-597 REQ-001 the module dispatches via api.orkyResolveEscalation/orkyRecordHumanGate/orkyDriveStatus only; no CLI/child_process/registry-mutation/electron/node-builtin path in either new file; the F6 pure module and slice gain NO bridge name; the orkyAction channel set is still 0007\'s four', () => {
    const src = actions()
    expect(src).toContain('api.orkyResolveEscalation(')
    expect(src).toContain('api.orkyRecordHumanGate(')
    expect(src).toContain('api.orkyDriveStatus(')
    for (const [rel, s] of [[ACTIONS, src], [CORE, core()]] as const) {
      for (const banned of ['child_process', 'execFile', 'registryAddRoot', 'registryRemoveRoot', 'orkySubmitWork', 'ipcRenderer', 'ipcMain', "from 'electron", "from 'node:", 'writeFile']) {
        expect(s, `${rel} must not reference ${banned}`).not.toContain(banned)
      }
    }
    // the core is PURE: api-free (window.termhalla throws under vitest — CLAUDE.md rule),
    // React-free and store-free, so its behavior suite can drive it directly.
    const c = core()
    expect(c).not.toMatch(/from ['"]react/)
    expect(c).not.toContain('../api')
    expect(c).not.toContain('useStore')
    // F6's pure module + slice stay read-only (REQ-001): none of the four bridge names appears.
    for (const rel of ['src/shared/decision-queue.ts', 'src/renderer/store/registry-slice.ts']) {
      const s = read(rel)
      for (const bridge of ['orkyResolveEscalation', 'orkyRecordHumanGate', 'orkyDriveStatus', 'orkySubmitWork']) {
        expect(s, `${rel} must not reference ${bridge}`).not.toContain(bridge)
      }
    }
    // F8 adds NO IPC surface: the orkyAction:* channel set is still exactly 0007's four.
    expect((read('src/shared/ipc-contract.ts').match(/'orkyAction:\w+'/g) ?? []).length).toBe(4)
  })

  it('TEST-607 REQ-001 REQ-005 single-call-site discipline: orky-entry-actions.tsx holds EXACTLY ONE call site per action bridge and is the ONLY file under src/renderer referencing them (no forked dispatch — REQ-011); the resumeInTerminal path issues ZERO api.orky* calls', () => {
    const src = actions()
    for (const bridge of ['api.orkyResolveEscalation(', 'api.orkyRecordHumanGate(', 'api.orkyDriveStatus(']) {
      expect(src.split(bridge).length - 1, `exactly one ${bridge} call site`).toBe(1)
    }
    // repo-scope: no OTHER renderer file references the three bridges (OrkyCaptureModal owns
    // orkySubmitWork only, per its own frozen suite).
    const rendererFiles = walk(resolve(process.cwd(), 'src/renderer'))
    for (const bridge of ['orkyResolveEscalation', 'orkyRecordHumanGate', 'orkyDriveStatus']) {
      const owners = rendererFiles
        .filter((f) => readFileSync(f, 'utf8').includes(bridge))
        .map((f) => f.replace(/\\/g, '/'))
      expect(owners, `${bridge} call sites`).toEqual(
        expect.arrayContaining([expect.stringContaining('orky-entry-actions.tsx')])
      )
      expect(owners.length, `${bridge} must have exactly one renderer owner`).toBe(1)
    }
    // resume is a pane commit, never an Orky dispatch (REQ-005 part 2 / REQ-014): the
    // resumeInTerminal function body contains no api.orky reference.
    const at = src.indexOf('resumeInTerminal')
    expect(at, 'resumeInTerminal must exist').toBeGreaterThanOrEqual(0)
    const open = src.indexOf('{', at)
    let depth = 0
    let end = src.length
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
    }
    expect(src.slice(at, end), 'resumeInTerminal must never dispatch an Orky action').not.toContain('api.orky')
  })
})

describe('testid namespace — dq-action-*, no orky-action/orkyaction substring (REQ-013 / frozen TEST-282 safety)', () => {
  it('TEST-598 REQ-013 all twelve pinned testids exist, dq-action-error carries data-error-kind, EVERY data-testid literal in the module starts with dq-action-, none contains the orky-action/orkyaction substrings, no enable-feedback affordance testid exists, and both file names avoid the banned substrings', () => {
    const src = actions()
    for (const tid of DQ_ACTION_TESTIDS) expect(src, `missing testid ${tid}`).toContain(`"${tid}"`)
    expect(src).toContain('data-error-kind')
    const literals = [...src.matchAll(/data-testid=\{?["'`]([^"'`]+)["'`]/g)].map((m) => m[1])
    expect(literals.length).toBeGreaterThanOrEqual(DQ_ACTION_TESTIDS.length)
    for (const tid of literals) {
      expect(tid, `testid ${tid} must live in the dq-action namespace`).toMatch(/^dq-action-/)
      expect(tid.toLowerCase()).not.toContain('orky-action')
      expect(tid.toLowerCase()).not.toContain('orkyaction')
      expect(tid.toLowerCase(), 'no enable affordance for the audited feedback toggle (REQ-009)').not.toContain('enable')
    }
    for (const rel of [ACTIONS, CORE]) {
      expect(rel.toLowerCase()).not.toContain('orkyaction')
      expect(rel.toLowerCase().includes('orky-action'), `${rel} must not match the frozen TEST-353/282 literals`).toBe(false)
    }
  })
})

describe('gesture-tying — dispatch lives in handlers, never an effect (REQ-006, CONV-033)', () => {
  it('TEST-599 REQ-006 NO useEffect callback in the module references api.orky* or commitPane — merely mounting can dispatch nothing; the structural property that makes StrictMode double-dispatch impossible', () => {
    const src = actions()
    for (const span of useEffectSpans(src)) {
      expect(span, 'a useEffect body must never dispatch an Orky action').not.toContain('api.orky')
      expect(span, 'a useEffect body must never commit a pane').not.toContain('commitPane')
    }
    // (the settle discipline itself is behaviorally frozen at the core seam — TEST-585/586 — and
    // end-to-end in TEST-608; no await-shape pin here, so the implementer may route the promise
    // through withSingleFlight however reads best)
  })
})

describe('the shared single-flight gate is CONSULTED by the hook (REQ-007)', () => {
  it('TEST-600 REQ-007 the hook imports the shared gate seam (withSingleFlight/isInFlight/subscribeFlights/flightKey) from the core module and routes BOTH async actions through withSingleFlight — never a per-instance ref/state gate', () => {
    const src = actions()
    const importLine = around(src, "from './orky-entry-actions-core'", 600, 0)
    for (const seam of ['withSingleFlight', 'isInFlight', 'subscribeFlights', 'flightKey']) {
      expect(importLine, `the hook must import ${seam} from the shared core`).toContain(seam)
    }
    // answer AND preview each gate through the shared registry (two call sites minimum)
    expect(src.split('withSingleFlight(').length - 1).toBeGreaterThanOrEqual(2)
    // pending derives from the SHARED seam so a second mount of the same target renders it too
    expect(src).toContain('subscribeFlights')
    expect(src).toContain('isInFlight(')
  })
})

describe('mode routing + the F10-reusable seam (REQ-002 / REQ-011)', () => {
  it('TEST-601 REQ-002 REQ-011 the module routes the answer mode through answerModeFor, exports useOrkyEntryActions + OrkyEntryActions over OrkyEntryTarget, and is pane-agnostic: no decision-queue/drawer/OrkyPane dependency', () => {
    const src = actions()
    expect(src).toContain('answerModeFor(')
    expect(src).toMatch(/export (function|const) useOrkyEntryActions/)
    expect(src).toMatch(/export (function|const) OrkyEntryActions/)
    expect(src).toContain('OrkyEntryTarget')
    // pane-agnostic (D5): F10's OrkyPane mounts this VERBATIM — no host-module import and no
    // host testid may leak in (import-scoped bans, CONV-037 spirit: prose/comments may
    // legitimately NAME the hosts; a dependency on them is what breaks the reuse seam)
    expect(src).not.toMatch(/from\s*['"]\.\/DecisionQueuePanel['"]/)
    expect(src).not.toMatch(/from\s*['"]\.\/OrkyPane['"]/)
    expect(src).not.toContain(String.raw`data-testid="decision-queue`)
  })

  it('TEST-602 REQ-011 REQ-001 DecisionQueuePanel composes <OrkyEntryActions> per row with the (projectRoot, featureSlug, reason) identity, supplies NO escalationId (the F8 row never carries one), and contains no api.orky* call of its own', () => {
    const src = panel()
    expect(src).toMatch(/import\s*\{[^}]*OrkyEntryActions[^}]*\}\s*from\s*['"]\.\/orky-entry-actions['"]/)
    const mount = around(src, '<OrkyEntryActions', 0, 400)
    expect(mount).toContain('it.projectRoot')
    expect(mount).toContain('it.featureSlug')
    expect(mount).toContain('it.status.reason')
    expect(mount, 'the queue row carries no escalation id — binding is the hook\'s display-time pull (REQ-003)').not.toContain('escalationId')
    expect(src, 'the panel forks no dispatch of its own (REQ-011)').not.toContain('api.orky')
  })
})

describe('pointer isolation — the click twin of CONV-030 (REQ-015, proposed CONV-041)', () => {
  it('TEST-603 REQ-015 a structural pin finds the isolation guard: either the actions-region stopPropagation boundary inside OrkyEntryActions, or a target-guarded row onClick in DecisionQueuePanel — one of the two MUST exist', () => {
    const regionBoundary = actions().includes('stopPropagation')
    const rowGuard = /onClick=\{\s*\(?\s*(e|ev|event)\b[\s\S]{0,240}?\.(target|composedPath)/.test(panel())
      || /\.target\s*[!=]==\s*\w+\.currentTarget[\s\S]{0,120}?focusProject/.test(panel())
    expect(
      regionBoundary || rowGuard,
      'REQ-015: an action click must never reach the row\'s own focus-project gesture — add the region stopPropagation boundary or target-guard the row onClick'
    ).toBe(true)
  })
})

describe('resume-in-terminal — the shipped run-on-spawn composition, stated honestly (REQ-014)', () => {
  it('TEST-604 REQ-014 [AMENDED — FINDING-008; was: the hook composes raw commitPane] one NARROW launchTerminalAt(cwd, launch) composition: the hook passes the entry projectRoot + the claude /orky:resume launch at gesture time (CONV-021 getState, NO envId, an "Orky resume" title); the store action fixes kind terminal + defaultShellId + the F6 workspace-less fallback and composes the INTERNAL commitPane; the control copy says terminal/claude/session and never claims an auto-run', () => {
    const src = actions()
    // the hook side: the narrow action, the pinned argv + title, gesture-time store access
    expect(src).toMatch(/launchTerminalAt\(\s*target\.projectRoot/)
    expect(src).toMatch(/command:\s*'claude'/)
    expect(src).toMatch(/args:\s*\[\s*'\/orky:resume'\s*\]/)
    expect(src).toMatch(/title:[^,\n}]*[Oo]rky resume/)
    expect(src).toContain('useStore.getState()')           // handler-only store reads (CONV-021)
    expect(src, 'no capability-bearing field rides the launch config').not.toContain('envId')
    // the store side: the narrow action owns the composition the raw primitive used to leak
    // (launchCommand's shape — kind fixed, shell derived, placement internal, cwd + launch honored)
    const store = read('src/renderer/store.ts')
    const impl = around(store, 'launchTerminalAt', 0, 900)
    expect(impl).toMatch(/kind:\s*'terminal'/)
    expect(impl).toContain('defaultShellId')
    expect(impl).toContain('newWorkspace')                 // the F6 pane-less fallback (REQ-014)
    expect(impl).toContain('commitPane(')                  // composed INTERNALLY, never exposed
    expect(impl).toContain('cwd')
    expect(impl, 'the narrow action hard-codes its safe subset — no capability-bearing field').not.toContain('envId')
    // honest affordance copy: opens a terminal/Claude session; never "resumed"/"auto-run"
    const controlRegion = around(src, 'dq-action-resume', 400, 400)
    expect(controlRegion).toMatch(/terminal|claude|session/i)
    expect(controlRegion).not.toMatch(/auto-?run|pipeline (advanced|resumed)/i)
  })
})

describe('failure synthesis + the detached outcome chokepoint (REQ-009 / REQ-010, CONV-034)', () => {
  it('TEST-605 REQ-009 REQ-010 an invoke REJECTION synthesizes the renderer-scoped ipc-failure kind (no catch assigns an F7 kind); a detached settle routes through the never-suppressed error-kind pushToast at the store seam; the honesty copy itself lives ONLY in the core classifier — the component builds no failure wording of its own [AMENDED — FINDING-012: a detached SUCCESS also rides pushToast (default suppressible kind) — no outcome is ever silently swallowed]', () => {
    const src = actions()
    const catches = catchBlocks(src)
    expect(catches.some((b) => b.includes('ipc-failure')), 'the invoke catch must synthesize ipc-failure').toBe(true)
    for (const kind of ['unknown-sender', 'invalid-args', 'root-not-allowed', 'gate-not-allowed', 'feature-not-found', 'feedback-disabled', 'orky-cli-not-found', 'cli-timeout', 'cli-error', 'cli-unparseable']) {
      for (const b of catches) {
        expect(b, `a catch must never assign the F7 kind '${kind}' (a synthesized verdict is never byte-identical to an F7-mapped one)`).not.toContain(`'${kind}'`)
      }
    }
    // CONV-034: the detached outcome reports through the store-level toast chokepoint as an
    // error-kind (never-suppressed, toasts-slice.ts:20) toast, read at settle time via getState.
    expect(src).toMatch(/pushToast\([^)]*,\s*['"]error['"]/)
    expect(src).toMatch(/getState\(\)[\s\S]{0,80}pushToast|getState\(\)\.pushToast/)
    // one source of honesty truth: the outcome copy comes from the core classifier
    // (settleAnswer/settlePreview — behaviorally frozen in orky-entry-actions-core.test.ts),
    // so the detached toast carries the SAME honesty class by construction (CONV-034).
    expect(src).toContain('settleAnswer')
    expect(src).toContain('settlePreview')
    // [AMENDED — FINDING-012] REQ-010: "the settled outcome MUST still be reported through the
    // store-level toast chokepoint (pushToast) … No outcome is ever silently swallowed." The
    // detached branch therefore routes BOTH outcome classes: the FAILURE keeps the never-suppressed
    // 'error' kind (pinned above), and the SUCCESS rides the DEFAULT (suppressible) kind carrying
    // the same core-classified message — mirroring F12 (OrkyCaptureModal.tsx:106-108). Suppression
    // is the STORE's mechanism (the kind !== 'error' early-return, toasts-slice.ts:20) — never a
    // drop at the call site. Behavioral half: e2e TEST-623 (drawer closed mid-flight → toast).
    const pushCalls = src.match(/pushToast\((?:[^()]|\([^()]*\))*\)/g) ?? []
    expect(pushCalls.some((c) => /['"]error['"]/.test(c)), 'the detached FAILURE keeps the never-suppressed error kind').toBe(true)
    const successCalls = pushCalls.filter((c) => !/['"]error['"]/.test(c))
    expect(successCalls.length, 'a detached SUCCESS must ALSO be pushed (default suppressible kind) — never dropped at the call site').toBeGreaterThanOrEqual(1)
    expect(successCalls.some((c) => c.includes('settled.message')), 'the detached success carries the core-classified message (honesty class preserved, CONV-034)').toBe(true)
  })
})

describe('keyboard + themed, accessible chrome (REQ-012, CONV-007/029/030)', () => {
  it('TEST-606 REQ-012 the dq-action chrome carries VISIBLE :focus-visible styling (never outline:none); activation surfaces are native <button>s; no raw hex outside a standard-fallback var(); any --status-failure use carries its #c62828 fallback', () => {
    const css = read('src/renderer/index.css')
    const focusBlocks = css.split('}').filter((b) => b.includes(':focus-visible') && b.includes('dq-action'))
    expect(focusBlocks.length, 'a :focus-visible rule must cover the dq-action chrome (CONV-007)').toBeGreaterThan(0)
    for (const block of focusBlocks) {
      expect(block).toMatch(/outline/)
      expect(block).not.toMatch(/outline:\s*none/)
    }
    const src = actions()
    // native activation surfaces (the F6 FINDING-008 lesson: never a role="button" wrapper)
    for (const tid of ['dq-action-answer-submit', 'dq-action-preview', 'dq-action-resume', 'dq-action-verdict-pass', 'dq-action-verdict-fail']) {
      const preceding = src.slice(Math.max(0, src.indexOf(`"${tid}"`) - 300), src.indexOf(`"${tid}"`))
      expect(preceding, `${tid} must be a native <button>`).toContain('<button')
    }
    expect(src).not.toContain('role="button"')
    // theme discipline (CONV-029 / the TEST-350 rule applied to the new module): hex only as var() fallback
    const stripped = src.replace(/var\(--[\w-]+\s*,\s*#[0-9a-fA-F]{3,8}\)/g, '')
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    if (src.includes('var(--status-failure')) {
      expect(src, 'failure styling uses the standard --status-failure fallback (CONV-029)').toMatch(/var\(--status-failure,\s*#c62828\)/)
    }
  })
})
