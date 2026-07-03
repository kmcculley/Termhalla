#!/usr/bin/env node
// Rebuild native modules (node-pty) against Electron's ABI, routing around two
// Windows-local gotchas that otherwise break the winpty compile. On non-Windows the
// guards below simply don't fire, so this is a safe pass-through to electron-rebuild.
// Run manually with `npm run rebuild:native` (add `-- --force` to force a rebuild).
//
//   1. Microsoft Store "python.exe" alias stub: node-gyp can't use it ("Python was not
//      found"). We resolve a REAL interpreter via the `py` launcher and pass it as
//      npm_config_python so node-gyp uses it directly.
//   2. NoDefaultCurrentDirectoryInExePath=1 (a security-hardening env var): stops
//      cmd.exe searching the current directory, so winpty.gyp's bare
//      `cd shared && GetCommitHash.bat` isn't found ("not recognized as a command").
//      We strip it from the CHILD env only — the OS-level setting is left intact.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const env = { ...process.env }

// (2) Strip the hardening var case-insensitively (Windows env-var keys vary in case).
for (const k of Object.keys(env)) {
  if (k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete env[k]
}

// (1) Resolve a real Python. Honor an explicit override, else ask the `py` launcher —
// it finds the real install even when `python.exe` on PATH is the Store alias stub.
function resolvePython() {
  const override = process.env.npm_config_python || process.env.PYTHON
  if (override && existsSync(override)) return override
  if (process.platform === 'win32') {
    try {
      const exe = execFileSync('py', ['-3', '-c', 'import sys; print(sys.executable)'],
        { encoding: 'utf8' }).trim()
      if (exe && existsSync(exe)) return exe
    } catch { /* no py launcher — fall through to node-gyp's own Python search */ }
  }
  return undefined
}
const py = resolvePython()
if (py) env.npm_config_python = py

const cli = path.join('node_modules', '@electron', 'rebuild', 'lib', 'cli.js')
if (!existsSync(cli)) {
  console.error(`[rebuild-native] ${cli} not found — is @electron/rebuild installed?`)
  process.exit(1)
}

// Build only node-pty by default (add `-- --force` to force). Without --force,
// electron-rebuild skips modules already built for the current ABI, so this stays
// cheap on repeat runs.
const passthrough = process.argv.slice(2)
const args = [cli, '-o', 'node-pty', '-m', '.', ...passthrough]
console.log(`[rebuild-native] python=${py ?? '(node-gyp default)'} | NoDefaultCurrentDirectoryInExePath=stripped | extra-args=${passthrough.join(' ') || '(none)'}`)

// Use the absolute node path (process.execPath) so this works even from a shell whose
// PATH lacks node (a bare background shell 127'd on a plain `node` invocation).
const res = spawnSync(process.execPath, args, { stdio: 'inherit', env })
process.exit(res.status ?? 1)
