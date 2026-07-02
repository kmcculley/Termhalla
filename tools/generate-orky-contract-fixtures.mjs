#!/usr/bin/env node
// Regenerates tests/fixtures/orky-contract/ from the REAL Orky producer (the gatekeeper CLI), so
// tests/shared/orky-contract-golden.test.ts asserts Termhalla's mirrors against artifacts Orky
// actually emitted — not against hand-copied literals. The generated fixtures are COMMITTED: the test
// itself never spawns the producer and runs green without Orky present; drift is surfaced whenever
// this script is re-run against a newer Orky and the refreshed fixtures turn the test red.
//
// Usage:  node tools/generate-orky-contract-fixtures.mjs
// The producer location defaults to the sibling checkout and is overridable via ORKY_PLUGIN_DIR
// (the directory containing gatekeeper/cli.js).
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = process.env.ORKY_PLUGIN_DIR ?? 'C:\\dev\\Orky\\plugin'
const CLI = join(PLUGIN_DIR, 'gatekeeper', 'cli.js')
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'orky-contract')

/** Run the gatekeeper CLI, returning raw stdout as a Buffer (osc-heartbeat is bytes, not JSON). */
const gk = (args, opts = {}) => execFileSync(process.execPath, [CLI, ...args], { ...opts })

mkdirSync(OUT_DIR, { recursive: true })

// 1. The machine-readable shared contract (phases, enums, OSC wire format — ADR-028), verbatim.
writeFileSync(join(OUT_DIR, 'contract.json'), gk(['contract']))

// 2. Drive the real gatekeeper in a throwaway project to produce a real state.json + active.json +
//    a raw OSC heartbeat byte sequence. The scaffold mirrors the producer's own test fixtures
//    (plugin/gatekeeper/test/gatekeeper.test.js scaffold()/fixtureProfile()): a single RED test that
//    requires a not-yet-written ./index.js, so the `tests` gate genuinely passes from ground truth.
const proj = mkdtempSync(join(tmpdir(), 'orky-contract-fixture-'))
try {
  mkdirSync(join(proj, 'test'), { recursive: true })
  writeFileSync(
    join(proj, 'test', 'add.test.js'),
    "const test = require('node:test');\n" +
    "const assert = require('node:assert');\n" +
    "const add = require('../index.js');\n" +
    "test('adds', () => { assert.strictEqual(add(2, 3), 5); });\n"
  )
  const profilePath = join(proj, 'profile.json')
  writeFileSync(profilePath, JSON.stringify({
    profile: 'fixture',
    commands: { build: 'node -e "process.exit(0)"', test: 'node --test test/add.test.js' },
    testRoots: ['test'],
    gates: { tests: ['tests-red'], implement: ['build', 'test', 'test-freeze'], review: ['findings'] }
  }, null, 2))

  const featureRel = join('.orky', 'features', '0001-golden')
  const featureDir = join(proj, featureRel)
  mkdirSync(featureDir, { recursive: true })

  // brainstorm is a human gate (record allowed freely); tests is re-derived by a REAL check run.
  gk(['record', '--feature', featureDir, '--gate', 'brainstorm', '--verdict', 'pass', '--evidence', 'golden fixture'])
  gk(['check', '--feature', featureDir, '--phase', 'tests', '--project', proj, '--profile', profilePath])
  gk(['heartbeat', '--project', proj, '--feature', featureRel, '--phase', 'implement', '--action', 'golden'])

  copyFileSync(join(featureDir, 'state.json'), join(OUT_DIR, 'state.json'))
  copyFileSync(join(proj, '.orky', 'active.json'), join(OUT_DIR, 'active.json'))

  // The raw OSC escape sequence exactly as emitted on stdout (intentionally NOT JSON) — saved as
  // bytes so the parser fixture is byte-for-byte the producer's output.
  writeFileSync(join(OUT_DIR, 'osc-heartbeat.bin'), gk(['osc-heartbeat', '--project', proj]))
} finally {
  rmSync(proj, { recursive: true, force: true })
}

console.log(`orky-contract fixtures regenerated into ${OUT_DIR} (producer: ${PLUGIN_DIR})`)
