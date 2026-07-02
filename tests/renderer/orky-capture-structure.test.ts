// FROZEN structural suite — feature 0012-quick-capture-inbox (phase 4). The vitest harness is
// node-env with no jsdom (vitest.config.ts), so the OrkyCaptureModal DOM/behavior contract is pinned
// the repo's established way (the 0009 orky-pane-structure precedent + the ESC-001/FINDING-020
// loopback ruling): source-scan tests over LITERAL, greppable source text — testids, aria, theme
// variables, import sites, handler placement — plus repo-level scope greps. Full rendered behavior
// (the real keyboard matrix, gesture-tied single dispatch, draft preservation, result copy) is
// asserted end-to-end in tests/e2e/orky-capture.spec.ts against the REAL StrictMode-wrapped tree.
//
// FINDING-004/StrictMode note: the spec's StrictMode vectors are satisfied per the F9 FINDING-020
// precedent by (a) the STRUCTURAL pin that the api.orkySubmitWork call lives in an event handler and
// NEVER inside any useEffect callback (TEST-489 — the one property that makes the double-dispatch
// class impossible under StrictMode's mount→unmount→remount), plus (b) the e2e zero/one dispatch
// counts against the shipped <StrictMode> tree. A node-env harness cannot mount a React lifecycle.
//
// Chosen contracts this suite freezes (implementers MUST keep every pinned literal greppable):
//   - the submit gesture handler in OrkyCaptureModal.tsx is a named function matching /submit/i and
//     contains the ONLY `api.orkySubmitWork(` call site in src/renderer/**;
//   - the in-flight/single-flight guard is component-local state matching /inFlight|submitting/;
//   - the success branch keys on `ok` AND `dispatched` (never exitCode/data re-derivation).
//
// Runs RED today: src/renderer/components/OrkyCaptureModal.tsx and
// src/renderer/store/orky-capture-slice.ts do not exist yet (readFileSync throws), the picker has no
// ariaLabel/heading props, App/CommandPalette have no capture wiring, and src/renderer contains ZERO
// orkySubmitWork call sites (TEST-488 demands exactly ONE).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')
const modal = () => read('src/renderer/components/OrkyCaptureModal.tsx')
const slice = () => read('src/renderer/store/orky-capture-slice.ts')
const picker = () => read('src/renderer/components/OrkyRootPicker.tsx')

// The feature's own renderer files (the REQ-005/REQ-011 scope-guard sweep set).
const F12_FILES = [
  'src/renderer/components/OrkyCaptureModal.tsx',
  'src/renderer/store/orky-capture-slice.ts'
]

// TEST-433's F9_FILES — F12 must add NO write-surface string to any of them (REQ-011 item b).
const F9_FILES = [
  'src/shared/orky-pane.ts',
  'src/renderer/components/OrkyPane.tsx',
  'src/renderer/components/OrkyRootPicker.tsx',
  'src/renderer/store/orky-pane-slice.ts',
  'src/main/orky/orky-root-detail.ts'
]

/** Recursively collect every file under a dir (for the src/renderer-wide call-site count). */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

/** Every balanced-paren `useEffect(...)` argument span in a source string (FINDING-004's structural
 *  pin needs the effect CALLBACKS, not a fragile proximity regex). */
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

describe('OrkyCaptureModal — the form contract (REQ-002, FINDING-003)', () => {
  it('TEST-484 REQ-002 all SEVEN non-error testids + the failure-only error region (data-error-kind) exist; role="dialog"/aria-modal with a /capture/i accessible name; both fields label-associated; submit disabled on whitespace-only title and in-flight', () => {
    const src = modal()
    for (const tid of [
      'data-testid="orky-capture"', 'orky-capture-title', 'orky-capture-detail', 'orky-capture-target',
      'orky-capture-change-root', 'orky-capture-submit', 'orky-capture-cancel', 'orky-capture-error'
    ]) expect(src, `modal must carry ${tid}`).toContain(tid)
    expect(src).toContain('data-error-kind={')            // machine-routable per-kind failure surface
    // the error region is CONDITIONAL chrome (failure-only, FINDING-003) — a conditional guard
    // precedes it (rendered/absent behavior is pinned end-to-end in the e2e)
    const errIdx = src.indexOf('orky-capture-error')
    expect(src.slice(Math.max(0, errIdx - 400), errIdx)).toMatch(/&&|\?/)
    expect(src).toContain('role="dialog"')
    expect(src).toContain('aria-modal')
    expect(src).toMatch(/aria-label['"]?[:=]\s*['"][^'"]*[Cc]apture/) // JSX attr or cardProps object form
    // label association for BOTH fields: the element carrying each testid has an accessible name path
    for (const tid of ['orky-capture-title', 'orky-capture-detail']) {
      const at = src.indexOf(tid)
      const tagStart = src.lastIndexOf('<', at)
      const tagEnd = src.indexOf('>', at)
      expect(src.slice(tagStart, tagEnd), `${tid} must be label-associated (id for htmlFor, or aria-label)`).toMatch(/\bid=|aria-label/)
    }
    // submit-enablement: whitespace-only titles disable (the ONLY client-side gate, REQ-010) and
    // an in-flight submission disables (single-flight, REQ-006)
    expect(src).toMatch(/disabled=\{/)
    expect(src).toMatch(/\.trim\(\)/)
    expect(src).toMatch(/inFlight|submitting/)
  })

  it('TEST-485 REQ-002 theme-token-only styling (CONV-029): --status-failure with its #c62828 fallback, never --status-fail; raw hex only as var() fallbacks; :focus-visible allow-list covers the capture chrome (CONV-007)', () => {
    const src = modal()
    expect(src).toContain('var(--status-failure')
    expect(src).toContain('#c62828')                       // the pinned standard fallback (0009 REQ-019)
    expect(src).not.toMatch(/--status-fail(?!ure)/)        // the non-existent variable name (CONV-029)
    const stripped = src.replace(/var\(--[\w-]+\s*,\s*#[0-9a-fA-F]{3,8}\)/g, '')
    expect(stripped, 'raw hex only as var() fallback').not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    // CONV-007: body-portalled chrome carries visible focus — an orky-capture :focus-visible rule exists
    const css = read('src/renderer/index.css')
    const blocks = css.split('}').filter(b => b.includes(':focus-visible') && /orky-capture/.test(b))
    expect(blocks.length, 'a :focus-visible rule must cover the orky-capture chrome').toBeGreaterThan(0)
    for (const b of blocks) {
      expect(b).toMatch(/outline/)
      expect(b).not.toMatch(/outline:\s*none/)
    }
  })
})

describe('OrkyRootPicker reuse — component identity, never a fork (REQ-003, FINDING-005)', () => {
  it('TEST-486 REQ-003 the modal IMPORTS the shared OrkyRootPicker and passes BOTH a capture-specific ariaLabel AND heading (coherent, /capture/i, never /bind/i); it renders no member-root list of its own and reads no registry surface', () => {
    const src = modal()
    expect(src).toMatch(/import\s*\{[^}]*OrkyRootPicker[^}]*\}\s*from\s*'\.\/OrkyRootPicker'/)
    // the ONE call site passes name + visible heading TOGETHER (FINDING-005 coherence)
    const at = src.indexOf('<OrkyRootPicker')
    expect(at, 'the modal must render the SHARED picker').toBeGreaterThanOrEqual(0)
    const tag = src.slice(at, src.indexOf('>', at) + 1)
    expect(tag).toContain('ariaLabel')
    expect(tag).toContain('heading')
    expect(tag).toMatch(/[Cc]apture/)
    expect(tag).not.toMatch(/[Bb]ind/)                     // capture, not pane binding
    // never forked, never a second registry consumer (REQ-003/REQ-012)
    for (const banned of ['orky-root-picker-item', 'registrySnapshot', 'useRegistryLoadState', 'registryError', 'registryCurrent']) {
      expect(src, `OrkyCaptureModal must not contain ${banned}`).not.toContain(banned)
    }
  })

  it('TEST-487 REQ-003 REQ-011 OrkyRootPicker gains ONLY additive, default-preserving optional props: ariaLabel?/heading? declared optional, BOTH F9 default literals still present byte-identically, and no F12 write-surface string enters the file', () => {
    const src = picker()
    expect(src).toMatch(/ariaLabel\?:/)                    // optional — omitting renders F9 byte-identically
    expect(src).toMatch(/heading\?:/)
    expect(src).toContain('Bind Orky pane to a tracked project')   // the F9 aria-label default (OrkyRootPicker.tsx:64)
    expect(src).toContain('Bind to a tracked Orky project')        // the F9 visible-header default (:66)
    // frozen TEST-433/434 stay green byte-unchanged; belt-and-braces here for the F12-specific strings
    for (const banned of ['orkyAction', 'orkySubmitWork', 'orky-capture']) {
      expect(src, `OrkyRootPicker must not gain ${banned}`).not.toContain(banned)
    }
  })
})

describe('write-surface scope — exactly one call site, zero new machinery (REQ-005)', () => {
  it('TEST-488 REQ-005 src/renderer/** contains EXACTLY ONE `orkySubmitWork(` call site — inside OrkyCaptureModal.tsx; no F12 file touches the other three actions, child_process, or logs the draft; ipc-contract still declares exactly the four 0007 orkyAction channels', () => {
    const rendererFiles = walk(resolve(process.cwd(), 'src/renderer'))
    let total = 0
    const hits: string[] = []
    for (const f of rendererFiles) {
      const n = (readFileSync(f, 'utf8').match(/orkySubmitWork\(/g) ?? []).length
      if (n > 0) hits.push(f)
      total += n
    }
    expect(total, `orkySubmitWork( call sites: ${hits.join(', ')}`).toBe(1)
    expect(hits).toHaveLength(1)
    expect(hits[0].replace(/\\/g, '/')).toContain('src/renderer/components/OrkyCaptureModal.tsx')
    for (const rel of F12_FILES) {
      const src = read(rel)
      for (const banned of ['orkyResolveEscalation', 'orkyRecordHumanGate', 'orkyDriveStatus', 'child_process', 'execFile', 'fsWrite', 'console.log']) {
        expect(src, `${rel} must not reference ${banned}`).not.toContain(banned)
      }
      // no phase/feature key can ride the request (decision #2: exactly projectRoot/title[/detail])
      expect(src, `${rel} must not build a phase field`).not.toMatch(/\bphase\b/)
    }
    // the diff adds NO IPC surface: the orkyAction:* channel set is still 0007's four
    const contract = read('src/shared/ipc-contract.ts')
    expect((contract.match(/'orkyAction:\w+'/g) ?? []).length).toBe(4)
  })

  it('TEST-489 REQ-006 gesture-tying is STRUCTURAL (FINDING-004): the one orkySubmitWork call sits in a /submit/i-named event handler, and NO useEffect callback in any F12 file references it (the property that makes StrictMode double-dispatch impossible)', () => {
    const src = modal()
    // a named submit handler owns the dispatch (chosen contract in the header)
    expect(src).toMatch(/(const|function)\s+\w*[sS]ubmit\w*/)
    for (const rel of F12_FILES) {
      const s = read(rel)
      for (const span of useEffectSpans(s)) {
        expect(span, `${rel}: a useEffect callback must never dispatch orkySubmitWork`).not.toContain('orkySubmitWork')
      }
    }
    // and the dispatch is not fire-and-forget wired to a submit-requested flag — the handler awaits
    // the promise (single-flight settles on the result; the count discipline is e2e-pinned)
    expect(src).toMatch(/await\s+(api\.)?orkySubmitWork\(|orkySubmitWork\([^)]*\)\s*\.then/)
  })
})

describe('keyboard + focus discipline (REQ-007, CONV-020, CONV-030)', () => {
  it('TEST-490 REQ-007 Escape handling, a target-guarded container handler (CONV-030), a mod+Enter path, and the SHARED useOpenFocusRestore hook (CONV-020) — never a hand-copied restore', () => {
    const src = modal()
    expect(src).toContain('Escape')
    expect(src).toMatch(/\.target\b/)                       // CONV-030: container handlers target-guard
    expect(src).toMatch(/ctrlKey|metaKey/)                  // the mod+Enter matrix row
    expect(src).toMatch(/import\s*\{[^}]*useOpenFocusRestore[^}]*\}\s*from\s*'\.\/use-open-focus-restore'/)
    expect(src, 'no duplicated focus-restore implementation').not.toContain('document.activeElement')
  })
})

describe('result honesty (REQ-008) + failure surfacing (REQ-009) + no client caps (REQ-010)', () => {
  it('TEST-491 REQ-008 the success branch keys on ok && dispatched (F7 semantics, never re-derived); the D5 copy claims captured/queued-for-triage, never accepted/started; confirmation rides the pushToast chokepoint', () => {
    const src = modal()
    expect(src).toMatch(/\bok\b[^\n]{0,60}&&[^\n]{0,60}\bdispatched\b/)  // the structural success key
    expect(src).toContain('Orky inbox for triage')          // decision #6 — literally true via the submit path
    expect(src).toMatch(/Captured/)
    expect(src).not.toMatch(/accepted|has started|started work|created a feature/i)
    expect(src).toContain('pushToast')                      // CONV-004's single chokepoint
    // never re-derive the verdict from the transport shape
    for (const banned of ['mapCliRunToResult', 'data.mode', 'data.sent', 'data.spooled']) {
      expect(src, `must not re-derive from ${banned}`).not.toContain(banned)
    }
    expect(src).not.toMatch(/\bexitCode\b/)
  })

  it('TEST-492 REQ-009 per-kind failure structure: feedback-disabled is a DISTINCT branch with NO enable affordance; cli-timeout copy is INDETERMINATE (CONV-015) with a duplicate-retry warning, never a definite non-capture; the region renders F7\'s error verbatim', () => {
    const src = modal()
    expect(src).toContain('feedback-disabled')              // the distinct branch exists
    expect(src).toContain('cli-timeout')
    expect(src).toMatch(/may (or may not )?have been/i)     // indeterminate wording
    expect(src).toMatch(/duplicate/i)                       // the retry warning
    expect(src).not.toMatch(/was not captured|failed to capture|definitely not/i)
    // no enable/auto-enable affordance, no feedback-config mutation (ADR-027: enabling is a human,
    // audited decision OUTSIDE Termhalla). The CLI's refusal text arrives via result.error at
    // runtime — never hard-coded here.
    for (const banned of ['config.json', 'enable-feedback', 'enableFeedback', 'disable-feedback']) {
      expect(src, `must not offer/perform ${banned}`).not.toContain(banned)
    }
    // the region surfaces the result's own error string (verbatim rendering pinned end-to-end in e2e)
    const errIdx = src.indexOf('orky-capture-error')
    expect(src.slice(errIdx, errIdx + 600)).toMatch(/error/i)
  })

  it('TEST-493 REQ-010 no client-side cap/truncation/rewrite (CONV-003): no maxLength on either field, no slice(/substring( applied to the draft values, in any F12 file', () => {
    for (const rel of F12_FILES) {
      const src = read(rel)
      expect(src, `${rel} must not cap field length`).not.toContain('maxLength')
      expect(src, `${rel} must not truncate values`).not.toMatch(/\.slice\(|\.substring\(/)
    }
  })
})

describe('frozen-guard compatibility — namespace + placement (REQ-011, REQ-012)', () => {
  it('TEST-494 REQ-011 every F12 testid lives in the orky-capture namespace and contains neither TEST-282 locator substring; no F9_FILE gains a write-surface string; no F12 file matches the registry mutation pattern; the slice holds no per-pane keyed map', () => {
    for (const rel of F12_FILES) {
      const src = read(rel)
      const lower = src.toLowerCase()
      expect(lower, `${rel} must never match TEST-282's locators`).not.toContain('orky-action')
      expect(lower, `${rel} must never match TEST-282's locators`).not.toContain('orkyaction')
      for (const m of src.matchAll(/data-testid="([^"]+)"/g)) {
        expect(m[1].startsWith('orky-capture'), `${rel}: testid ${m[1]} must live in the orky-capture namespace`).toBe(true)
      }
      expect(src, `${rel} must not reference the registry mutation surface (TEST-362's live sweep)`)
        .not.toMatch(/RegistryMutationResult|registryRoots\s*\(|registryAddRoot\s*\(|registryRemoveRoot\s*\(/)
    }
    // placement constraint (decision #7): the dispatch string appears in NO F9 file — TEST-433 stays
    // green byte-unchanged; its eventual supersession belongs to F10, not F12
    for (const rel of F9_FILES) {
      const src = read(rel)
      expect(src, `${rel} must not gain orkyAction`).not.toContain('orkyAction')
      expect(src, `${rel} must not gain orkySubmitWork`).not.toContain('orkySubmitWork')
    }
    // REQ-012: session chrome only — no per-pane keyed runtime state in the capture slice
    expect(slice()).not.toMatch(/paneId|Record<string/)
  })

  it('TEST-495 REQ-001 REQ-006 App.tsx hosts the modal app-level and its keydown case reads NO activeId; CommandPalette handles capture-orky-work BEFORE the activeId guard (the toggle-orky-queue precedent)', () => {
    const app = read('src/renderer/App.tsx')
    expect(app).toContain('<OrkyCaptureModal')
    const caseIdx = app.indexOf("case 'capture-orky-work'")
    expect(caseIdx, 'App keydown switch must handle capture-orky-work').toBeGreaterThanOrEqual(0)
    const caseBody = app.slice(caseIdx, app.indexOf('break', caseIdx))
    expect(caseBody).toContain('openOrkyCapture(')
    expect(caseBody, 'the capture case must work with NO active workspace').not.toContain('activeId')
    const palette = read('src/renderer/components/CommandPalette.tsx')
    const actionIdx = palette.indexOf("'capture-orky-work'")
    const guardIdx = palette.indexOf('if (!activeId) return')
    expect(actionIdx, 'palette must activate capture-orky-work').toBeGreaterThanOrEqual(0)
    expect(guardIdx).toBeGreaterThanOrEqual(0)
    expect(actionIdx, 'capture must be handled BEFORE the activeId guard').toBeLessThan(guardIdx)
    expect(palette).toContain('openOrkyCapture')
  })

  it('TEST-496 REQ-012 zero IPC on mount: the modal\'s ONLY api.* usage is orkySubmitWork (no registryCurrent/registryDetail/fetch on open) and the slice is api-free', () => {
    const apiUses = new Set([...modal().matchAll(/\bapi\.(\w+)/g)].map(m => m[1]))
    expect([...apiUses]).toEqual(['orkySubmitWork'])
    expect(slice()).not.toMatch(/\bapi\.|from '\.\.?\/(api|\.\.\/api)'/)
    expect(slice()).not.toContain("from '../api'")
  })
})
