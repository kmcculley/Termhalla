// FROZEN doc-drift guard — feature 0013-os-needs-you-notifications (phase 4 / REQ-014, doc-sync gate).
// REQ-014 requires: a feature doc under docs/features/ covering the main-process observer, the
// transition-diff/dedupe/throttle/digest model (tumbling window, constants), the pane-less
// notification case, the app-wide opt-in (default enabled, live-refresh, no restart), click-to-focus /
// drawer reveal, and the strictly-read-only scope guard; a CLAUDE.md "Where things live" reference; a
// CHANGELOG [Unreleased] entry naming the OS needs-you notifications AND the new app-wide opt-in; the
// new orkyNotify:focus channel documented wherever the IPC contract is documented; and no stale doc
// claim that the registry aggregate has no main-side notifier or that there is no app-wide
// notification setting. Mirrors tests/docs-feature-0012.test.ts. Runs RED until doc-sync reconciles.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

function unreleasedSection(): string {
  const changelog = readFileSync(resolve(process.cwd(), 'CHANGELOG.md'), 'utf8')
  const start = changelog.indexOf('## [Unreleased]')
  expect(start, 'CHANGELOG.md must have an [Unreleased] section').toBeGreaterThanOrEqual(0)
  const rest = changelog.slice(start + '## [Unreleased]'.length)
  const nextHeading = rest.search(/\n## \[/)
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).toLowerCase()
}
const fileLower = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8').toLowerCase()

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

describe('TEST-571 REQ-014 docs traceability — feature 0013 OS needs-you notifications', () => {
  it('a feature doc covers the observer, the throttle/digest model, the pane-less case, the app-wide opt-in and the read-only scope', () => {
    const doc = fileLower('docs/features/os-needs-you-notifications.md')
    expect(doc).toMatch(/needs[- ]you|needshuman/)
    expect(doc).toMatch(/observer/)
    expect(doc).toMatch(/digest/)
    expect(doc).toMatch(/tumbling|coalesce|window/)
    expect(doc).toMatch(/pane-?less|no open pane/)
    expect(doc).toMatch(/opt-?in|mute/)
    expect(doc).toMatch(/default (on|enabled)/)
    expect(doc).toMatch(/no restart|live/)
    expect(doc).toContain('orkynotify:focus')
    expect(doc).toMatch(/read-?only/)
  })

  it('CLAUDE.md references the feature doc (Where things live)', () => {
    expect(fileLower('CLAUDE.md')).toContain('os-needs-you-notifications')
  })

  it('CHANGELOG [Unreleased] names the OS needs-you notifications AND the new app-wide opt-in (default on)', () => {
    const s = unreleasedSection()
    expect(s).toMatch(/needs[- ]you|need a decision|need you/)
    expect(s).toMatch(/notification/)
    expect(s).toMatch(/opt-?in|mute|setting|toggle/)
  })
})

describe('TEST-572 REQ-014 IPC-contract doc + stale-claim reconciliation (CONV-008)', () => {
  it('the orkyNotify:focus channel appears wherever the IPC contract is documented (the contract source itself documents it)', () => {
    const contract = readFileSync(resolve(process.cwd(), 'src/shared/ipc-contract.ts'), 'utf8')
    expect(contract).toContain('orkyNotify:focus')
  })

  it('no living doc still claims the registry aggregate has no main-side notifier, or that there is no app-wide notification setting', () => {
    const roots = [resolve(process.cwd(), 'docs'), resolve(process.cwd(), '.orky/baseline')]
    const files: string[] = []
    for (const r of roots) { try { files.push(...walk(r)) } catch { /* absent tree */ } }
    files.push(resolve(process.cwd(), 'CLAUDE.md'))
    const offenders: string[] = []
    for (const f of files) {
      let src: string
      try { src = readFileSync(f, 'utf8') } catch { continue }
      for (const line of src.split('\n')) {
        const l = line.toLowerCase()
        if (/no main-?side notifier|aggregate has no notifier|no app-?wide notification setting|no app-?wide opt-?in/.test(l)) {
          offenders.push(`${f}: ${line.trim()}`)
        }
      }
    }
    expect(offenders, `stale needs-you-notifier claims:\n${offenders.join('\n')}`).toEqual([])
  })
})
