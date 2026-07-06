// Docs suite — feature 0024-agent-daemonization (phase 4, revision 3 — REQ-017 as amended).
// The shipped no-daemonization claims are retired COHERENTLY (CONV-008) — every live phrasing,
// located by grep over the living surfaces (docs/, CLAUDE.md, .orky/baseline/, and the remote
// client-flow source comments that carry the "lands with no client change" claim), never only
// the files the spec enumerates. Historical records (docs/superpowers/, .orky/features/) are
// excepted per the REQ. The updated docs must ADDITIONALLY state (a) the PER-WORKSPACE daemon
// model (D6′/REQ-018), (b) the protocol-versioning rule REQ-012 relies on — recorded both in
// the feature docs and at the protocol barrel's doc comment — and, since revision 3, (c) the
// THREE-GESTURE survival story (D10/REQ-019): quit-app, banner disconnect, AND closing the
// workspace tab all DETACH, while an individual pane close stays a deliberate kill. Doc-sync
// makes these true; the pins define the contract (the docs-feature-0022 precedent — runs RED
// today).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = process.cwd()
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8')

const walk = (dir: string, exts: string[], skipDirs: string[] = []): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (!skipDirs.includes(name)) out.push(...walk(p, exts, skipDirs))
    } else if (exts.some((e) => p.endsWith(e))) out.push(p)
  }
  return out
}

/** The retired claims, exactly as REQ-017 enumerates their phrasings. */
const BANNED = [
  /not daemonized/i,
  /no daemonization/i,
  /dies with the stdio/i,
  /lands with no client change/i
]

describe('TEST-2441 REQ-017 no living surface still claims the agent is not daemonized', () => {
  it('CLAUDE.md, docs/ (superpowers history excepted), .orky/baseline/, and src/main/remote/ carry no retired claim', () => {
    const surfaces: string[] = [resolve(root, 'CLAUDE.md')]
    surfaces.push(...walk(resolve(root, 'docs'), ['.md'], ['superpowers']))
    if (existsSync(resolve(root, '.orky/baseline'))) {
      surfaces.push(...walk(resolve(root, '.orky/baseline'), ['.md']))
    }
    surfaces.push(...walk(resolve(root, 'src/main/remote'), ['.ts']))

    const offenders: string[] = []
    for (const f of surfaces) {
      const text = readFileSync(f, 'utf8')
      for (const re of BANNED) {
        if (re.test(text)) offenders.push(`${f} still matches ${String(re)}`)
      }
    }
    expect(offenders, `retire every phrasing in the SAME change (CONV-008):\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('TEST-2442 REQ-017 the living docs describe the SHIPPED per-workspace daemon contract', () => {
  it('docs/features/remote-agent.md documents the workspace-keyed on-disk daemon contract', () => {
    const doc = read('docs/features/remote-agent.md').toLowerCase()
    for (const phrase of ['daemon', '.sock', 'daemon-']) {
      expect(doc, `remote-agent.md must cover "${phrase}"`).toContain(phrase)
    }
    expect(doc, 'the on-disk names are workspace-keyed (agent-<wsToken>.sock etc.)').toMatch(/wstoken|workspace/)
  })

  it('docs/features/remote-workspaces.md states the PER-WORKSPACE daemon model and the survival story (keeps TEST-2278 green)', () => {
    const doc = read('docs/features/remote-workspaces.md').toLowerCase()
    expect(doc).toContain('daemon') // the frozen docs-feature-0022 pin keeps requiring the word
    expect(doc, 'the reconnect story is now survival, not death-on-disconnect').toMatch(/surviv/)
    expect(doc, 'one daemon per remote workspace; same-host workspaces independent (D6′/REQ-018)')
      .toMatch(/per[- ]workspace/)
  })

  it('the protocol barrel carries the proto-versioning rule REQ-012 relies on', () => {
    const barrel = read('src/shared/remote/protocol.ts')
    expect(barrel, 'any wire-visible protocol change MUST bump proto — recorded at the barrel\'s doc comment')
      .toMatch(/bump/i)
    expect(barrel.toLowerCase(), 'the rule speaks about the wire protocol version').toContain('proto')
  })

  it('a feature doc records that routine app updates preserve remote sessions (the D4′ consequence, honestly scoped)', () => {
    const agentDoc = read('docs/features/remote-agent.md').toLowerCase()
    const wsDoc = read('docs/features/remote-workspaces.md').toLowerCase()
    expect(`${agentDoc}\n${wsDoc}`, 'the auto-update survival consequence is stated in the living feature docs')
      .toMatch(/update/)
  })

  it('CLAUDE.md mentions the daemon in its remote-stack rows', () => {
    expect(read('CLAUDE.md').toLowerCase().includes('daemon'), 'CLAUDE.md must mention the daemon').toBe(true)
  })
})

describe('TEST-2465 REQ-017 the docs tell the THREE-GESTURE survival story (locked D10 / REQ-019)', () => {
  it('remote-workspaces.md: quit-app, banner disconnect, AND close-tab all DETACH; a pane close stays a deliberate kill; an unreopened workspace idle-reaps', () => {
    const doc = read('docs/features/remote-workspaces.md').toLowerCase()
    expect(doc, 'the close-TAB gesture is documented').toMatch(/tab/)
    expect(doc, 'a tab close DETACHES — it never kills remote panes').toMatch(/detach/)
    expect(doc, 'quit-app rides the same one survival story').toMatch(/quit/)
    expect(doc, 'closing an individual remote pane remains a deliberate kill')
      .toMatch(/pane[^.\n]{0,160}kill|kill[^.\n]{0,160}pane/)
    expect(doc, 'an unreopened workspace\'s daemon idle-reaps (REQ-006 bounds accumulation)').toMatch(/idle/)
  })
})
