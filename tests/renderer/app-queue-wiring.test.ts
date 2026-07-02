// FROZEN structural suite — feature 0006-decision-queue-panel (phase 4 / REQ-001/REQ-002/REQ-003/REQ-011).
// App-level wiring: the registry:status subscription lives in App.tsx's one-shot push-subscription
// block with exactly ONE generation-guarded registryCurrent() recovery pull (the cloudCurrent
// missed-push pattern), the drawer mounts as window chrome outside the mosaic subtree only while
// open, and the shortcut switch dispatches toggle-orky-queue. Renderer/shared-only (D2): no main,
// no preload, no new channel. Source-scan per 03-plan.md "Testability constraint"; the live recovery
// behavior is covered at the slice seam (registry-slice.test.ts TEST-337) and e2e.
// Runs RED: App.tsx has none of this wiring yet.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CH } from '@shared/ipc-contract'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')
const app = () => read('src/renderer/App.tsx')
const count = (src: string, needle: string) => src.split(needle).length - 1

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...listFiles(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('App.tsx — subscription + single recovery pull (REQ-003/REQ-011)', () => {
  it('TEST-357 REQ-003 REQ-011 one onRegistryStatus subscription, exactly ONE registryCurrent() pull, generation-guarded through the slice chokepoint', () => {
    const src = app()
    expect(count(src, 'onRegistryStatus(')).toBe(1)
    expect(count(src, 'registryCurrent()')).toBe(1)
    // Both paths route through the single ingestion chokepoint / arbitration seam (TASK-005/007).
    expect(src).toContain('setRegistrySnapshot')
    expect(src).toContain('applyRecoveryPull')
    expect(src).toContain('snapshotGeneration')   // captured at ISSUE time (FINDING-004)
    expect(src).toContain('recoveryPullFailed')   // the rejection path is explicit, never swallowed silently
  })

  it('TEST-358 REQ-003 REQ-017 no new IPC by F6: F5\'s five registry channels remain, and no main/preload file knows the feature (open-formed by 0009 REQ-003)', () => {
    const registryChannels = Object.values(CH).filter(v => typeof v === 'string' && v.startsWith('registry:')).sort()
    // SUPERSEDED point-in-time pin (CONV-019, via feature 0009-native-orky-pane REQ-003's protocol;
    // DISCOVERED at F9's test design — see 0009's 04-tests.md): F6's still-true intent is "F6 itself
    // added no IPC", not "the registry read domain never grows" — F9 sanctions registry:detail +
    // registry:rootChanged (exact post-F9 set pinned in tests/main/register-registry-detail.test.ts,
    // TEST-409). Open-form: F5's five channels remain present.
    expect(registryChannels).toEqual(expect.arrayContaining([
      'registry:addRoot', 'registry:current', 'registry:removeRoot', 'registry:roots', 'registry:status'
    ]))
    const mainAndPreload = [
      ...listFiles(resolve(process.cwd(), 'src', 'main')),
      ...listFiles(resolve(process.cwd(), 'src', 'preload'))
    ]
    const offenders = mainAndPreload.filter(f => /decision-?queue|DecisionQueue|queueOpen/i.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('App.tsx — drawer mount + shortcut dispatch (REQ-001/REQ-002)', () => {
  it('TEST-359 REQ-001 the drawer mounts ONLY while open, as a chrome sibling of NotesPanel, never inside the mosaic subtree', () => {
    const src = app()
    expect(src).toMatch(/queueOpen\s*&&\s*<DecisionQueuePanel/)
    expect(src).toContain('<NotesPanel')
    // Not mosaic-hosted: the workspace view never renders it (also pinned in TEST-344).
    expect(read('src/renderer/components/WorkspaceView.tsx')).not.toContain('DecisionQueuePanel')
  })

  it('TEST-360 REQ-002 the existing shortcut switch dispatches toggle-orky-queue to setQueueOpen', () => {
    expect(app()).toMatch(/case 'toggle-orky-queue':[\s\S]{0,160}setQueueOpen/)
  })

  it('TEST-361 REQ-007 REQ-011 the subscription is app-level, not drawer-mounted: the panel itself wires no IPC (badge stays live while closed)', () => {
    const panel = read('src/renderer/components/DecisionQueuePanel.tsx')
    expect(panel).not.toContain('onRegistryStatus')
    expect(panel).not.toContain('registryCurrent')
  })
})
