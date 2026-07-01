// Test fixture (feature 0007-orky-action-dispatch) — prints its own argv back as JSON so
// tests/main/orky-cli-runner.test.ts can prove args are passed as a real argv ARRAY (never
// shell-concatenated / shell-interpreted — REQ-010's injection-safety requirement).
'use strict'
process.stdout.write(JSON.stringify(process.argv.slice(2)))
process.exitCode = 0
