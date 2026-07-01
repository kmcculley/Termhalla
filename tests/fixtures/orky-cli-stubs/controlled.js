// Test fixture (feature 0007-orky-action-dispatch) — a tiny standalone Node CLI stub used by
// tests/main/orky-cli-runner.test.ts to exercise the REAL `execFile` wiring in `orky-cli-runner.ts`
// against an actual child process (not a fake), per the plan's "SMALL number of tests exercise the real
// runner against a stub CLI fixture" guidance.
//
// Invoked as: node controlled.js '<JSON control object>'
// control = { exitCode?: number; stdout?: string; sleepMs?: number }
'use strict'
let control = {}
try { control = JSON.parse(process.argv[2] || '{}') } catch { control = {} }
const exitCode = typeof control.exitCode === 'number' ? control.exitCode : 0
const stdout = typeof control.stdout === 'string' ? control.stdout : JSON.stringify({ ok: true })
const sleepMs = typeof control.sleepMs === 'number' ? control.sleepMs : 0

function finish() {
  process.stdout.write(stdout)
  process.exitCode = exitCode
}

if (sleepMs > 0) setTimeout(finish, sleepMs)
else finish()
