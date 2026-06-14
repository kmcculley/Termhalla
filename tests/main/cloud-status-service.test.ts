import { describe, it, expect, vi } from 'vitest'
import { CloudStatusService } from '../../src/main/cloud/cloud-status-service'
import { awsProvider } from '../../src/main/cloud/providers'
import type { ProbeResult } from '../../src/main/cloud/classify'

const okAws: ProbeResult = { code: 0, stdout: JSON.stringify({ Account: '111', Arn: 'a' }) }
const provs = [awsProvider]

describe('CloudStatusService.refresh', () => {
  it('emits a checking status first, then the resolved status', async () => {
    const emit = vi.fn()
    const svc = new CloudStatusService(emit, provs, () => Promise.resolve(okAws), () => 1)
    await svc.refresh()
    const states = emit.mock.calls.map(c => (c[0] as { state: string }[])[0].state)
    expect(states[0]).toBe('checking')
    expect(states[states.length - 1]).toBe('logged-in')
  })

  it('maps a missing CLI to not-installed', async () => {
    const emit = vi.fn()
    const svc = new CloudStatusService(emit, provs, () => Promise.resolve({ errorCode: 'ENOENT', code: null, stdout: '' }), () => 1)
    await svc.refresh()
    expect((emit.mock.calls.at(-1)![0] as { state: string }[])[0].state).toBe('not-installed')
  })

  it('retains the last good result on a transient error (stale-while-revalidate)', async () => {
    const emit = vi.fn()
    const results: ProbeResult[] = [okAws, { code: 0, stdout: 'broken json' }]
    let i = 0
    const svc = new CloudStatusService(emit, provs, () => Promise.resolve(results[i++]), () => 1)
    await svc.refresh()   // logged-in
    await svc.refresh()   // parse error -> retain logged-in
    const last = (emit.mock.calls.at(-1)![0] as { state: string }[])[0]
    expect(last.state).toBe('logged-in')
  })

  it('does not run overlapping refresh cycles', async () => {
    const probe = vi.fn(() => new Promise<ProbeResult>(r => setTimeout(() => r(okAws), 5)))
    const svc = new CloudStatusService(vi.fn(), provs, probe, () => 1)
    await Promise.all([svc.refresh(), svc.refresh()])
    expect(probe).toHaveBeenCalledTimes(1)
    svc.stop()
  })

  it('passes an abort signal to the probe and aborts it on stop', async () => {
    let captured: AbortSignal | undefined
    const svc = new CloudStatusService(vi.fn(), provs,
      (_p, signal) => { captured = signal; return Promise.resolve(okAws) }, () => 1)
    await svc.refresh()
    expect(captured).toBeInstanceOf(AbortSignal)
    expect(captured!.aborted).toBe(false)
    svc.stop()
    expect(captured!.aborted).toBe(true)
  })
})
