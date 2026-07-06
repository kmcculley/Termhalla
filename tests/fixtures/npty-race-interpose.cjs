// FROZEN test fixture — feature 0023-remote-node-pty-prebuilt (phase 4, REQ-015 as amended by
// the FINDING-013 / ESC-001 / ESC-002 loopback; RE-AMENDED through the same feature's tests
// phase after the FINDING-020-cluster / ESC-003 loopback: the promote is now RENAME-FIRST with
// a single replace retry, so a genuine exit-95 needs the divergent install to REAPPEAR after
// the loser's sanctioned replace — the new NPTY_INTERPOSE_EVERY mode; and the reader-atomicity
// consequences now carry their own observation vectors — the new NPTY_INTERPOSE_LOG op log).
//
// Preloaded via `node --require` in front of the REAL `UNPACK_SRC` unpacker script. It
// deterministically reproduces the two-connect promote race that FINDING-013 identified:
// an fs rename whose destination basename is exactly `node-pty` (the sole promote commit
// point, `<agentDir>/node_modules/node-pty`) first has "the other connect's" promoted install
// interposed at the destination — exactly as if the racing winner promoted inside this loser's
// promote window — and then delegates to the ORIGINAL fs API, which therefore throws the
// genuine platform collision error (ENOTEMPTY/EEXIST on POSIX; EPERM under the local-node
// Windows harness — the platform-equivalent collision the amended REQ-015 names).
//
// All three rename APIs are interposed (renameSync / rename / promises.rename) so the harness
// is agnostic to which one UNPACK_SRC uses. The removal APIs (rmSync / rm / promises.rm /
// rmdirSync) are wrapped for OBSERVATION only (never altered): with NPTY_INTERPOSE_LOG set,
// every rename/removal whose target basename is `node-pty` is appended as one JSON line
// {op: 'rename'|'rm', path} — the seam the REQ-015 reader-atomicity vectors read to prove
// (a) the promote is rename-FIRST (no unconditional pre-rename removal of the final dir) and
// (b) an identical-install loser never removes the final dir at all.
//
// Env contract:
//   NPTY_INTERPOSE_SRC   — a directory copied verbatim to the rename destination before
//                          delegating (the winner's promoted install; the test controls its
//                          marker: identical sha ⇒ benign lost race, exit 0; different sha /
//                          no marker ⇒ the loser's replace retry — see NPTY_INTERPOSE_EVERY).
//   NPTY_INTERPOSE_MODE  — 'divergent' (used when NPTY_INTERPOSE_SRC is unset — the fake-ssh
//                          `npty-race-divergent` rig): synthesize a minimal install whose
//                          marker carries a DIFFERENT ptyNodeSha256 (64 × 'd').
//   NPTY_INTERPOSE_EVERY — '1': re-inject before EVERY node-pty-destination rename (not only
//                          the first), so the divergent install REAPPEARS after the loser's
//                          replace retry — the persistent-divergent-racer shape whose ONLY
//                          legal outcome is sentinel 95 (amended REQ-015 step 3).
//   NPTY_INTERPOSE_LOG   — a file path: append the {op, path} observation lines described
//                          above (observe-only; set it WITHOUT SRC/MODE for a pure observer).
const fs = require('node:fs')
const path = require('node:path')

let fired = false
const every = (process.env.NPTY_INTERPOSE_EVERY || '') === '1'
const logFile = process.env.NPTY_INTERPOSE_LOG || ''

function record(op, target) {
  if (logFile === '') return
  const p = String(target)
  if (path.basename(p) !== 'node-pty') return
  fs.appendFileSync(logFile, JSON.stringify({ op, path: p }) + '\n')
}

function inject(newPath) {
  const dest = String(newPath)
  if (path.basename(dest) !== 'node-pty') return
  if (fired && !every) return
  fired = true
  const src = process.env.NPTY_INTERPOSE_SRC || ''
  if (src !== '') {
    fs.cpSync(src, dest, { recursive: true })
    return
  }
  if ((process.env.NPTY_INTERPOSE_MODE || '') === 'divergent') {
    fs.mkdirSync(dest, { recursive: true })
    fs.writeFileSync(path.join(dest, 'lib-placeholder.js'), '// the other connect installed this\n')
    fs.writeFileSync(
      path.join(dest, '.termhalla-prebuilt.json'),
      JSON.stringify({
        formatVersion: 1,
        nodePtyVersion: '9.9.9-other',
        target: 'linux-x64-glibc',
        ptyNodeSha256: 'd'.repeat(64)
      })
    )
  }
}

const origRenameSync = fs.renameSync
fs.renameSync = function (oldPath, newPath) {
  record('rename', newPath)
  inject(newPath)
  return origRenameSync.call(fs, oldPath, newPath)
}

const origRename = fs.rename
fs.rename = function (oldPath, newPath, cb) {
  record('rename', newPath)
  inject(newPath)
  return origRename.call(fs, oldPath, newPath, cb)
}

const origPromisesRename = fs.promises.rename
fs.promises.rename = function (oldPath, newPath) {
  record('rename', newPath)
  inject(newPath)
  return origPromisesRename.call(fs.promises, oldPath, newPath)
}

// Observation-only wrappers (behavior never altered) — the reader-atomicity op log.
const origRmSync = fs.rmSync
fs.rmSync = function (target, opts) {
  record('rm', target)
  return origRmSync.call(fs, target, opts)
}

const origRmdirSync = fs.rmdirSync
fs.rmdirSync = function (target, opts) {
  record('rm', target)
  return origRmdirSync.call(fs, target, opts)
}

const origRm = fs.rm
fs.rm = function (target, opts, cb) {
  record('rm', target)
  return origRm.call(fs, target, opts, cb)
}

const origPromisesRm = fs.promises.rm
fs.promises.rm = function (target, opts) {
  record('rm', target)
  return origPromisesRm.call(fs.promises, target, opts)
}
