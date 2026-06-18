import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UsageMetrics } from '../../src/shared/types'
import { UsageTracker } from '../../src/main/usage/usage-tracker'
import { encodeProjectDir } from '../../src/main/usage/project-dir'

function asstLine(input: number, cacheRead: number): string {
  return JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: input, output_tokens: 10, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0 } } })
}
function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const i = setInterval(() => {
      if (pred()) { clearInterval(i); resolve() }
      else if (Date.now() - t0 > ms) { clearInterval(i); reject(new Error('timeout')) }
    }, 25)
  })
}

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.restoreAllMocks() })

describe('UsageTracker', () => {
  function setup(model?: string): { home: string; cwd: string; projDir: string } {
    const home = mkdtempSync(join(tmpdir(), 'ut-home-'))
    const cwd = mkdtempSync(join(tmpdir(), 'ut-cwd-'))
    const projDir = join(home, 'projects', encodeProjectDir(cwd))
    mkdirSync(projDir, { recursive: true })
    if (model) writeFileSync(join(home, 'settings.json'), JSON.stringify({ model }), 'utf8')
    cleanups.push(() => { rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }) })
    return { home, cwd, projDir }
  }

  it('re-resolves to the live transcript when a newer one appears (stale-binding fix)', async () => {
    const { home, cwd, projDir } = setup()
    // A stale, assistant-less stub is the newest .jsonl at watch-start.
    writeFileSync(join(projDir, 'stale.jsonl'), JSON.stringify({ type: 'user' }), 'utf8')

    const emits: Array<UsageMetrics | null> = []
    const tracker = new UsageTracker((_id, m) => emits.push(m), home, 50)
    cleanups.push(() => tracker.dispose())
    await tracker.watch('p1', cwd)

    // Initial parse binds to the stub: zeroed metrics, not the real session.
    expect(emits.at(-1)).toMatchObject({ contextTokens: 0 })

    // The live session writes a newer transcript — must be picked up without re-watching.
    await new Promise(r => setTimeout(r, 30))
    writeFileSync(join(projDir, 'live.jsonl'), [asstLine(100, 50000)].join('\n'), 'utf8')

    await waitFor(() => (emits.at(-1)?.contextTokens ?? 0) > 0)
    expect(emits.at(-1)!.contextTokens).toBe(50100) // 100 + 50000
  })

  it('clears stale metrics (emits null) and warns when the transcript read fails', async () => {
    const { home, cwd, projDir } = setup()
    // A `.jsonl` entry that is actually a directory: it stat()s fine (so resolveTranscript selects it
    // as the newest), but readFile() throws EISDIR — the path that previously returned with no emit,
    // freezing the display on whatever stale value it last showed.
    mkdirSync(join(projDir, 'live.jsonl'))

    const emits: Array<UsageMetrics | null> = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tracker = new UsageTracker((_id, m) => emits.push(m), home, 50)
    cleanups.push(() => tracker.dispose())
    await tracker.watch('p1', cwd)

    expect(emits.at(-1)).toBeNull()        // stale data cleared, not frozen
    expect(warn).toHaveBeenCalled()        // failure is diagnosable, not silent
  })

  it('reports the 1M window from the settings model alias', async () => {
    const { home, cwd, projDir } = setup('opus[1m]')
    writeFileSync(join(projDir, 'sess.jsonl'), [asstLine(120, 150000)].join('\n'), 'utf8')

    const emits: Array<UsageMetrics | null> = []
    const tracker = new UsageTracker((_id, m) => emits.push(m), home, 50)
    cleanups.push(() => tracker.dispose())
    await tracker.watch('p1', cwd)

    await waitFor(() => emits.length > 0)
    const m = emits.at(-1)!
    expect(m).not.toBeNull()
    expect(m!.contextTokens).toBe(150120)
    expect(m!.contextWindow).toBe(1_000_000)
    expect(m!.contextPct).toBe(15)
  })
})
