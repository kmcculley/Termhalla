// App-level INTEGRATION suite — F14 (OSC heartbeat parse/render) against the REAL Orky emitter
// (`gatekeeper osc-heartbeat`, ADR-026) run over the SAME synthetic fixture the filesystem path
// reads, so the two independent status transports — stream-parsed PTY bytes vs. `.orky/` file reads
// — are proven to agree on one ground truth. Also pins the F14 × 0004 precedence seam
// (`selectOrkyPaneStatus`) with two REAL statuses, and the read-only-ness of the emitter itself.
//
// Live-PTY delivery (a real pty feeding OrkyOscParser inside Termhalla's PtyManager) remains
// env-blocked in this harness (node-env vitest; no ConPTY) — the BYTES here are nevertheless the
// real emitter's bytes, captured via the same runOrkyCli seam F7 uses, and fed through the same
// parser class production wires into the pty data path. The renderer-composited surfaces ride the
// existing per-feature e2e specs.
//
// Span map — TEST-703..TEST-706:
//   TEST-703  REAL emitter (gatekeeper osc-heartbeat) → F14 parser → shared orky-status render ↔
//             filesystem detail (F9/F5 mappers) PARITY on the same fixture project
//   TEST-704  F14 stream reassembly: the real emitter's marker split byte-by-byte amid terminal
//             noise still parses to the identical heartbeat
//   TEST-705  REAL app-loop (feature-less) heartbeat → the cleared/empty pane shape (REQ-011)
//   TEST-706  F14 × 0004 precedence: filesystem status wins; stream is the fallback
//   (plus, inside TEST-703/705: the emitter made ZERO writes under .orky/ — read-only contract)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'
import type { OrkyFeatureStatus, OrkyHeartbeat, OrkyPaneStatus } from '@shared/types'
import { orkyHeartbeatToPaneStatus, orkyPaneStatus, selectOrkyPaneStatus } from '@shared/orky-status'
import { OrkyOscParser, ORKY_OSC } from '../../src/main/status/orky-osc-parser'
import { runOrkyCli } from '../../src/main/orky/orky-cli-runner'
import { locateOrkyCli } from '../../src/main/orky/orky-cli-locate'
import { assembleOrkyRootDetail } from '../../src/main/orky/orky-root-detail'
import {
  seedMultiProjectFixture, hashTree, diffTrees,
  ORKY_PLUGIN_DIR, hasOrkyPlugin, ALPHA_FEATURE,
  type OrkyFixture
} from './orky-fixture'

const BEL = '\x07'

let fx: OrkyFixture
let gatekeeperCli: string
let alphaBaseline: Map<string, string>
let realMarkerBytes: string // the real emitter's raw OSC output for alpha's escalated feature

describe.skipIf(!hasOrkyPlugin)('OSC loop: the REAL Orky emitter → F14 parser → shared status render', () => {
  beforeAll(async () => {
    fx = seedMultiProjectFixture('orky-int-osc-')
    alphaBaseline = hashTree(join(fx.alpha, '.orky'))
    gatekeeperCli = locateOrkyCli('gatekeeper', { ORKY_PLUGIN_DIR })!
    expect(gatekeeperCli).toBeTruthy()

    const run = await runOrkyCli(gatekeeperCli, [
      'osc-heartbeat', '--project', fx.alpha, '--feature', fx.alphaFeatureDir
    ])
    expect(run.exitCode).toBe(0)
    expect(run.timedOut).toBe(false)
    realMarkerBytes = run.stdout
  }, 30_000)

  afterAll(() => {
    fx?.dispose()
  })

  // TEST-703 — the transport-parity proof: one ground truth (alpha's escalated feature), two
  // independent read paths (ADR-026 stream bytes vs. `.orky/` filesystem reads through the F5/F9
  // mapper pipeline) — same needs-you verdict, same gate fraction, same feature identity.
  it('TEST-703: real emitter bytes parse to the same status the filesystem path derives', async () => {
    // Wire framing (ADR-026): introducer + code 9999 + `;`, BEL-terminated, single-line JSON.
    expect(realMarkerBytes.startsWith(ORKY_OSC)).toBe(true)
    expect(realMarkerBytes.endsWith(BEL)).toBe(true)

    const heartbeats = new OrkyOscParser().push(realMarkerBytes)
    expect(heartbeats).toHaveLength(1)
    const hb: OrkyHeartbeat = heartbeats[0]
    expect(hb.feature).toBe(ALPHA_FEATURE)
    expect(hb.phase).toBe('review')
    expect(hb.gateN).toBe(5)
    expect(hb.gateM).toBe(8)
    expect(hb.needsHuman).toBe(true)     // the REAL drive(): open escalation → await-human
    expect(hb.reason).toBe('open escalation')

    // Stream-side render: the SAME orkyPaneStatus roll-up 0004 uses for every other source.
    const streamStatus = orkyHeartbeatToPaneStatus(hb)
    expect(streamStatus.kind).toBe('needs-input')
    expect(streamStatus.needsHuman).toBe(true)
    expect(streamStatus.chipFeature).toBe(ALPHA_FEATURE)
    expect(streamStatus.label).toBe(`${ALPHA_FEATURE} · review · 5/8`)

    // Filesystem-side render over the SAME bytes on disk (the F9 detail assembler → the shared
    // mapper pipeline): the two transports agree on every load-bearing verdict.
    const detail = await assembleOrkyRootDetail(fx.alpha, { now: () => Date.now() })
    if (!detail.ok) throw new Error(detail.error)
    const fsFeature = detail.features.find(f => f.slug === ALPHA_FEATURE)!.status
    expect(fsFeature.needsHuman).toBe(hb.needsHuman)
    expect(fsFeature.reason).toBe('escalation') // the fs path's closed enum for the same condition
    expect(fsFeature.gateN).toBe(hb.gateN)
    expect(fsFeature.gateM).toBe(hb.gateM)
    expect(fsFeature.phase).toBe(hb.phase)
    expect(fsFeature.kind).toBe(streamStatus.kind)

    // The emitter is a READER: producing the heartbeat wrote nothing under .orky/ (item 6 again,
    // now for the Orky-side status emitter Termhalla consumes).
    expect(diffTrees(alphaBaseline, hashTree(join(fx.alpha, '.orky'))))
      .toEqual({ added: [], removed: [], changed: [] })
  })

  // TEST-704 — chunked delivery: real PTY output arrives in arbitrary splits; the parser's bounded
  // carry-over reassembles the REAL emitter's marker byte-by-byte, amid surrounding terminal noise.
  it('TEST-704: the real marker split byte-by-byte amid terminal noise parses identically', () => {
    const noisy = `PS C:\\work> orky drive\r\n${realMarkerBytes}\r\nPS C:\\work> `
    const parser = new OrkyOscParser()
    const collected: OrkyHeartbeat[] = []
    for (const ch of noisy) collected.push(...parser.push(ch))
    expect(collected).toHaveLength(1)
    expect(collected[0]).toEqual(new OrkyOscParser().push(realMarkerBytes)[0])
  })

  // TEST-705 — the app-loop tick: no feature context (charlie's active.json has feature:null) →
  // the REAL emitter sends the minimal alive signal → F14 maps it to the cleared pane shape,
  // never a fabricated chip (REQ-011).
  it('TEST-705: a real feature-less heartbeat maps to the cleared pane shape', async () => {
    const charlieBaseline = hashTree(join(fx.charlie, '.orky'))
    const run = await runOrkyCli(gatekeeperCli, ['osc-heartbeat', '--project', fx.charlie])
    expect(run.exitCode).toBe(0)

    const heartbeats = new OrkyOscParser().push(run.stdout)
    expect(heartbeats).toHaveLength(1)
    expect(heartbeats[0].feature).toBeNull()
    expect(heartbeats[0].action).toBe('idle between runs') // active.json.lastAction, verbatim

    const status = orkyHeartbeatToPaneStatus(heartbeats[0])
    expect(status).toEqual({
      kind: 'idle', label: '', needsHuman: false, failed: false, features: [], chipFeature: null
    })

    expect(diffTrees(charlieBaseline, hashTree(join(fx.charlie, '.orky'))))
      .toEqual({ added: [], removed: [], changed: [] })
  })

  // TEST-706 — the F14 × 0004 composition seam with two REAL statuses: the filesystem source wins
  // whenever present; the stream source is only the no-filesystem fallback (SSH/remote case).
  it('TEST-706: filesystem status takes precedence over the stream status; stream is the fallback', async () => {
    const streamStatus = orkyHeartbeatToPaneStatus(new OrkyOscParser().push(realMarkerBytes)[0])

    const detail = await assembleOrkyRootDetail(fx.alpha, { now: () => Date.now() })
    if (!detail.ok) throw new Error(detail.error)
    const fsStatus: OrkyPaneStatus = orkyPaneStatus(
      detail.features.map(f => f.status as OrkyFeatureStatus)
    )

    expect(selectOrkyPaneStatus(fsStatus, streamStatus)).toBe(fsStatus)   // fs wins (same object)
    expect(selectOrkyPaneStatus(null, streamStatus)).toBe(streamStatus)  // remote fallback
    expect(selectOrkyPaneStatus(fsStatus, null)).toBe(fsStatus)
  })
})
