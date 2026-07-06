// FROZEN test fixture — feature 0020-ssh-tunnel-provisioned-bootstrap (phase 4).
// AMENDED (sanctioned, CONV-012) — feature 0023-remote-node-pty-prebuilt (phase 4, REQ-025);
// RE-AMENDED through the same feature's re-run tests phase after the FINDING-013 / ESC-001 /
// ESC-002 loopback (the 'npty-race-divergent' rig), and RE-AMENDED AGAIN after the
// FINDING-020-cluster / ESC-003 loopback with the rigs the amended REQ-012/016/021/025/026
// mandate: 'npty-preseed-corrupt' (the self-repair fixture — an intact marker over corrupted
// on-disk pty.node bytes), 'npty-launch-die[:-once]:modfail|glibc' (a launch that dies before
// hello with rigged stderr in the module-resolution or GLIBC class), 'npty-probe-endless'
// (sentinel then an unbounded stdout stream — the settle-on-sentinel rig) and
// 'npty-probe-flood' (an oversized sentinel-less stream — the bounded rc-noise rig); the
// 'npty-race-divergent' rig now runs the interposer in PERSISTENT mode (NPTY_INTERPOSE_EVERY)
// because the amended REQ-015 rename-first promote REPAIRS a one-shot divergent collision —
// only a divergent install that reappears after the single replace retry is a genuine 95.
// AMENDED (sanctioned, CONV-012) — feature 0024-agent-daemonization (phase 4, REQ-016;
// RE-AMENDED through the revision-2 tests phase after the ESC-001 loop-back, per D6′): the shim
// recognizes the amended REQ-009 daemon-flow launch shape INCLUDING the workspace scope
// (test -f P && exec node P --attach --pty=B --ws=T || exit 127) and runs the REAL bridge as a
// local child with an injected portable --socket path, so the bridge's DETACHED daemon child is
// a PERSISTENT daemon KEYED BY wsToken per fake home that outlives individual shim invocations
// (the reconnect-fidelity AND same-host-coexistence substrate — REQ-018: distinct tokens on one
// fake home get distinct sockets and daemons). Ledger kinds gained: 'daemon-attach' (one per
// daemon-flow launch, carrying { ws: token }) and 'daemon-spawn' (appended with the token when
// the bridge's TERMHALLA_BRIDGE_V1 status line reports spawned:true). New env:
//   FAKE_SSH_DAEMON_SOCKET   explicit daemon socket path override (single-workspace rigs; else
//                            derived per fake home × wsToken — a \\.\pipe\ name on win32,
//                            else <home>/.termhalla/agent/agent-<ws>.sock, mirroring the
//                            production ws-derived name)
//   FAKE_SSH_DAEMON_IDLE_MS  appended to the bridge argv as --idle-timeout-ms=<n> (forwarded
//                            by the bridge to any daemon it spawns — the idle-out rigs)
// The 0024 rigs (stale remnants, never-accepting daemon, the old-APP-version-same-proto
// AUTO-UPDATE daemon, the proto-drift daemon, concurrent first-connects to ONE workspace, two
// DISTINCT workspaces on one fake home) are realized by PRE-SEEDING the fake home
// (daemon-<ws>.json / dummy pids / transformed-bundle artifacts / test-launched persistent
// daemons) plus these env vars — deterministic, no new FAKE_SSH_RIG switches, existing
// launch/upload/npty handling byte-identical. Still network-module-free (TEST-2006) and
// POSIX-shell-free.
// The shim recognizes the two `node -e` command shapes of the node-pty co-provision wire
// contract (the REQ-008 probe and the REQ-014 install) and executes their embedded
// single-quote-free scripts with the LOCAL node for fidelity. Existing launch/upload handling
// is byte-identical; the shim stays network-module-free (TEST-2006) and POSIX-shell-free.
//
// The fake `ssh` shim (REQ-018): a stand-in for the system OpenSSH binary, spawned by the
// remote-client spawn seam as `process.execPath + [thisFile, ...realSshArgv]`. It accepts the
// REAL builder-produced argv (`[-p PORT] [-i IDENTITY] user@host <one remote command string>`),
// consults an env-configured fake remote home, and emulates EXACTLY the remote command shapes
// the specs pin (the F19 REQ-009 launch probe, the F19 REQ-012 upload, and 0023's probe +
// node-pty install) with Node fs / child_process primitives — no POSIX shell, so it runs on
// windows-latest CI; no network modules, ever (a structural test scans this file). The agent,
// when "launched", runs as a LOCAL child process — the identical protocol path production runs
// over ssh (locked decision 1).
//
// Env contract (all rig switches are env-driven — deterministic, REQ-018):
//   FAKE_SSH_HOME      (required) directory acting as the remote $HOME; `~/` resolves here.
//   FAKE_SSH_LOG       (optional) append one JSON line {kind, destination, command} per
//                      invocation — the CONV-051-scoped invocation ledger tests count.
//                      kinds: launch | upload | probe | node-pty-install | other.
//   FAKE_SSH_PROBE_TRIPLE (optional, 0023) JSON {platform, arch, glibc} — the synthesized
//                      probe triple: the shim runs the REAL probe script locally (real marker
//                      / resolves / actual-hash fidelity) then rewrites ONLY those three fields
//                      on the sentinel line, so non-win32 triples are testable on windows-latest.
//   FAKE_SSH_RIG       (optional) failure rigs:
//                        'exit255'      — behave like an ssh transport/auth failure: write a
//                                         diagnostic to stderr, exit 255 before interpreting.
//                        'stall'        — log, then hold the connection open forever (never
//                                         output, never exit) until killed — abort-path rig.
//                        'ignore-upload'— launch behaves normally; an upload consumes stdin,
//                                         reports success (exit 0) but writes NOTHING.
//                        'truncate:<n>' — an upload receives only the first <n> bytes (the
//                                         remote wc -c check must then fail → rm tmp, exit 93).
//                        'npty-truncate:<n>' (0023) — a node-pty install's stdin payload loses
//                                         its LAST <n> bytes (short read → the unpacker's
//                                         byte-count sentinel 93; the header line stays intact).
//                        'npty-corrupt' (0023) — a node-pty install payload has one byte of its
//                                         pty.node region flipped (sha mismatch → sentinel 94).
//                        'npty-stall-install' (0023) — the probe proceeds normally, the
//                                         node-pty install stalls forever — mid-install abort rig.
//                        'npty-probe-noise' (0023) — shell-rc noise lines are emitted before and
//                                         after the probe's sentinel line (REQ-009 line scan).
//                        'npty-race-divergent' (0023, ESC-001/ESC-002; re-armed for ESC-003) —
//                                         the node-pty install's REAL unpacker runs with the
//                                         fs-rename interposer (npty-race-interpose.cjs)
//                                         preloaded in PERSISTENT 'divergent' mode
//                                         (NPTY_INTERPOSE_EVERY): its promote collides with a
//                                         divergent install that REAPPEARS after the single
//                                         replace retry → the genuine sentinel-95 path.
//                        'npty-preseed-corrupt' (0023, ESC-003 / FINDING-020) — before the REAL
//                                         probe script runs, the on-disk pty.node under the
//                                         remote install dir (if present) has one byte flipped
//                                         while its marker stays INTACT — the REQ-012
//                                         self-repair fixture (the probe must report the
//                                         ground-truth actual hash, and the decision must be
//                                         install, never skip).
//                        'npty-launch-die:modfail' / 'npty-launch-die-once:modfail' /
//                        'npty-launch-die:glibc' (0023, ESC-003 — REQ-016/REQ-021) — a launch
//                                         dies before hello (exit 1) with rigged stderr of the
//                                         node-pty module-resolution class ('modfail') or the
//                                         GLIBC_x.y-not-found class ('glibc'); the '-once'
//                                         variant dies only on the FIRST launch of this fake
//                                         home (state file .npty-launch-died-once) — the
//                                         recovery-cycle rig.
//                        'npty-probe-endless' (0023, ESC-003 — REQ-026) — the REAL probe runs
//                                         and its sentinel line is emitted, then the shim keeps
//                                         streaming stdout noise (bounded at 120 s so a broken
//                                         client cannot hang the suite forever) — the client
//                                         must settle on the sentinel and tear the child down.
//                        'npty-probe-flood' (0023, ESC-003 — REQ-026) — the probe emits ~200 KiB
//                                         of sentinel-LESS stdout noise then exits 0 — the
//                                         rc-noise fatal with a cap-bounded excerpt.
//
// Exit codes mirror the spec sentinels: 127 launch-absent (REQ-009), 93 upload-not-promoted
// (F19 REQ-012) / node-pty byte-count mismatch (0023 REQ-015), 94 node-pty sha mismatch (0023
// REQ-015), 95 node-pty divergent promote collision persisting through the replace retry (0023
// REQ-015 as amended), 255 transport rig, 12 = shim-level argv/command parse error (a test bug,
// never a legitimate outcome).
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { resolve as resolvePath, dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

const die = (code, msg) => {
  if (msg) process.stderr.write(`FAKE-SSH: ${msg}\n`)
  process.exit(code)
}

const home = process.env.FAKE_SSH_HOME
if (!home) die(12, 'FAKE_SSH_HOME is not set')

/** `~/x/y` → under FAKE_SSH_HOME; used for every remote path in a command. */
const resolveRemote = (p) => {
  if (p === '~') return resolvePath(home)
  if (p.startsWith('~/')) return resolvePath(home, p.slice(2))
  return resolvePath(home, p.startsWith('/') ? p.slice(1) : p)
}

// ---- argv parsing: [-p PORT] [-i IDENTITY] user@host <command> --------------------------
const argv = process.argv.slice(2)
let destination = ''
let command = ''
{
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a === '-p' || a === '-i') { i += 2; continue }
    if (a.startsWith('-')) die(12, `unexpected option ${a}`)
    destination = a
    i += 1
    break
  }
  const rest = argv.slice(argv.indexOf(destination) + 1)
  if (!destination.includes('@')) die(12, `destination "${destination}" is not user@host`)
  if (rest.length !== 1) die(12, `expected exactly one remote command argv element, got ${rest.length}`)
  command = rest[0]
}

const PROBE_SENTINEL = 'TERMHALLA_PROBE_V1 '

const kindOf = (cmd) =>
  cmd.startsWith('test -f ') ? (cmd.includes(' --attach ') ? 'daemon-attach' : 'launch')
    : cmd.startsWith('mkdir -p ') ? 'upload'
      : cmd.startsWith("node -e '") ? (cmd.includes('TERMHALLA_PROBE_V1') ? 'probe' : 'node-pty-install')
        : 'other'

if (process.env.FAKE_SSH_LOG) {
  const wsMatch = command.match(/ --ws=([A-Za-z0-9_-]{1,64}) /)
  appendFileSync(process.env.FAKE_SSH_LOG,
    JSON.stringify({ kind: kindOf(command), ...(wsMatch ? { ws: wsMatch[1] } : {}), destination, command }) + '\n')
}

const rig = process.env.FAKE_SSH_RIG || ''
if (rig === 'exit255') die(255, 'connection failed (rig: exit255) — permission denied, please try again')
if (rig === 'stall') {
  // Hold the "connection" open without ever producing output; consume stdin so the client
  // can keep writing. Killed by the client's abort path (REQ-016).
  process.stdin.on('data', () => {})
  setInterval(() => {}, 1 << 30)
} else {
  interpret()
}

/** The per-fake-home × per-WORKSPACE daemon socket (0024, D6′): explicit via
 *  FAKE_SSH_DAEMON_SOCKET (single-workspace rigs), else a stable name derived from the fake
 *  home AND the wsToken — a named pipe on win32 (a filesystem path cannot back an AF_UNIX
 *  socket there), the production-mirroring <home>/.termhalla/agent/agent-<ws>.sock elsewhere.
 *  Distinct tokens on one home MUST get distinct sockets (REQ-018). */
function daemonSocketPath(wsToken) {
  if (process.env.FAKE_SSH_DAEMON_SOCKET) return process.env.FAKE_SSH_DAEMON_SOCKET
  if (process.platform !== 'win32') return resolvePath(home, '.termhalla', 'agent', `agent-${wsToken}.sock`)
  const tag = createHash('sha1').update(`${resolvePath(home)}|${wsToken}`).digest('hex').slice(0, 12)
  return `\\\\.\\pipe\\termhalla-fake-ssh-${tag}`
}

function interpret() {
  // ---- 0024 REQ-009 daemon-flow launch (revision 2, D6′):
  //      test -f P && exec node P --attach --pty=B --ws=T || exit 127
  // The bridge runs as a LOCAL child with a portable --socket injected (win32 named pipe /
  // posix path under the fake home) PLUS the forwarded --ws scope, so the daemon it spawns is
  // DETACHED and persists per home × TOKEN (metadata/log at the ws-keyed names).
  const daemonLaunch = command.match(/^test -f (\S+) && exec node \1 --attach --pty=(node-pty|fake) --ws=([A-Za-z0-9_-]{1,64}) \|\| exit 127$/)
  if (daemonLaunch) {
    const wsToken = daemonLaunch[3]
    const artifact = resolveRemote(daemonLaunch[1])
    if (!existsSync(artifact)) die(127, `agent artifact absent at ${daemonLaunch[1]}`)
    const args = [artifact, '--attach', `--pty=${daemonLaunch[2]}`, `--ws=${wsToken}`, `--socket=${daemonSocketPath(wsToken)}`]
    if (process.env.FAKE_SSH_DAEMON_IDLE_MS) args.push(`--idle-timeout-ms=${process.env.FAKE_SSH_DAEMON_IDLE_MS}`)
    const child = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    })
    process.stdin.pipe(child.stdin)
    child.stdout.pipe(process.stdout)
    // stderr passes through AND is sniffed once for the bridge status line, so the ledger can
    // distinguish attach-to-existing from a fresh daemon spawn ('daemon-spawn').
    let sniff = ''
    child.stderr.on('data', (c) => {
      process.stderr.write(c)
      if (sniff === null) return
      sniff += c.toString('utf8')
      const line = sniff.split('\n').find((l) => l.startsWith('TERMHALLA_BRIDGE_V1 '))
      if (line) {
        sniff = null
        try {
          const status = JSON.parse(line.slice('TERMHALLA_BRIDGE_V1 '.length))
          if (status.spawned === true && process.env.FAKE_SSH_LOG) {
            appendFileSync(process.env.FAKE_SSH_LOG,
              JSON.stringify({ kind: 'daemon-spawn', ws: wsToken, destination, command }) + '\n')
          }
        } catch { /* a malformed status line is the client's problem, not the shim's */ }
      } else if (sniff.length > 65536) {
        sniff = null
      }
    })
    child.on('close', (code) => {
      process.exitCode = code === null ? 1 : code
      process.stdin.unpipe(child.stdin)
      process.stdin.destroy()
    })
    child.on('error', (e) => die(12, `failed to spawn local bridge: ${String(e)}`))
    return
  }

  // ---- REQ-009 launch probe: test -f P && exec node P --pty=B || exit 127 ----------------
  const launch = command.match(/^test -f (\S+) && exec node \1 --pty=(node-pty|fake) \|\| exit 127$/)
  if (launch) {
    // 0023 ESC-003 launch rigs (REQ-016/REQ-021): die before hello with class-rigged stderr.
    const launchDie = rig.match(/^npty-launch-die(-once)?:(modfail|glibc)$/)
    if (launchDie) {
      const once = launchDie[1] === '-once'
      const onceMarker = resolvePath(home, '.npty-launch-died-once')
      if (!once || !existsSync(onceMarker)) {
        if (once) writeFileSync(onceMarker, 'died\n')
        const stderrText = launchDie[2] === 'modfail'
          ? `Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'node-pty' imported from ${launch[1]}\n`
          : "node: /lib/x86_64-linux-gnu/libc.so.6: version 'GLIBC_2.34' not found (required by ~/.termhalla/agent/node_modules/node-pty/build/Release/pty.node)\n"
        process.stderr.write(stderrText)
        process.exit(1)
      }
    }
    const artifact = resolveRemote(launch[1])
    if (!existsSync(artifact)) die(127, `agent artifact absent at ${launch[1]}`)
    const child = spawn(process.execPath, [artifact, `--pty=${launch[2]}`], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    })
    process.stdin.pipe(child.stdin)
    child.stdout.pipe(process.stdout)
    child.stderr.pipe(process.stderr)
    // 'close' (not 'exit') + natural termination: the child's piped stdio has fully flushed
    // into ours, and we avoid process.exit() dropping async std writes on Windows (the same
    // rationale as src/agent/main.ts's shutdown path).
    child.on('close', (code) => {
      process.exitCode = code === null ? 1 : code
      process.stdin.unpipe(child.stdin)
      process.stdin.destroy()
    })
    child.on('error', (e) => die(12, `failed to spawn local agent: ${String(e)}`))
    return
  }

  // ---- REQ-012 upload: mkdir -p D && cat > T && [ "$(wc -c < T)" -eq N ] && mv T F
  //      || { rm -f T; exit 93; } ------------------------------------------------------------
  const upload = command.match(
    /^mkdir -p (\S+) && cat > (\S+) && \[ "\$\(wc -c < \2\)" -eq (\d+) \] && mv \2 (\S+) \|\| \{ rm -f \2; exit 93; \}$/
  )
  if (upload) {
    const dir = resolveRemote(upload[1])
    const tmp = resolveRemote(upload[2])
    const expected = Number(upload[3])
    const final = resolveRemote(upload[4])
    if (!tmp.startsWith(dir + sep) && dirname(tmp) !== dir) die(12, 'upload tmp path escapes the install dir')
    mkdirSync(dir, { recursive: true })

    const truncate = rig.startsWith('truncate:') ? Number(rig.slice('truncate:'.length)) : Infinity
    const chunks = []
    let received = 0
    process.stdin.on('data', (c) => {
      if (received < truncate) {
        const take = Math.min(c.length, truncate - received)
        chunks.push(c.subarray(0, take))
      }
      received += c.length
    })
    process.stdin.on('end', () => {
      if (rig === 'ignore-upload') process.exit(0) // pretend success, write nothing
      const body = Buffer.concat(chunks)
      writeFileSync(tmp, body)
      if (body.length !== expected) {
        rmSync(tmp, { force: true })
        die(93, `received ${body.length} bytes, expected ${expected} — artifact not promoted`)
      }
      renameSync(tmp, final)
      process.exit(0)
    })
    return
  }

  // ---- 0023 REQ-008/REQ-014: node -e '<single-quote-free script>' <args...> ---------------
  // The probe carries ONE arg (agentDir); the install carries TWO (agentDir + nonce). The
  // embedded scripts run under the LOCAL node — the same interpreter a remote Linux host
  // provides — with any `~`-rooted arg resolved into the fake home.
  const nodeE = command.match(/^node -e '([^']*)' (.+)$/)
  if (nodeE) {
    runNodeE(nodeE[1], nodeE[2].split(' '))
    return
  }

  die(12, `unrecognized remote command shape: ${command}`)
}

/** Flip one byte of the on-disk pty.node under the remote install dir while its marker stays
 *  intact — the REQ-012 self-repair fixture (ESC-003 / FINDING-020): a skip decision that
 *  trusted the marker alone would wedge; the ground-truth probe must force an install. */
function corruptOnDiskPtyNode(agentDirResolved) {
  const p = join(agentDirResolved, 'node_modules', 'node-pty', 'build', 'Release', 'pty.node')
  if (!existsSync(p)) return
  const b = readFileSync(p)
  if (b.length === 0) return
  b[0] = b[0] ^ 0xff
  writeFileSync(p, b)
}

function runNodeE(script, args) {
  const isProbe = script.includes('TERMHALLA_PROBE_V1')
  if (!isProbe && rig === 'npty-stall-install') {
    // Mid-install abort rig (0023 REQ-017): consume stdin, never answer, never exit.
    process.stdin.on('data', () => {})
    setInterval(() => {}, 1 << 30)
    return
  }
  const resolved = args.map((a) => (a.startsWith('~') ? resolveRemote(a) : a))

  if (isProbe && rig === 'npty-probe-flood') {
    // REQ-026: an oversized, sentinel-LESS stdout stream (≈ 200 KiB) — the client must produce
    // the rc-noise fatal with an excerpt bounded by its stated cap, without unbounded growth.
    const line = 'rc noise flood: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'
    for (let i = 0; i < 3500; i += 1) process.stdout.write(line)
    process.exitCode = 0
    process.stdin.destroy() // let stdout drain naturally - process.exit() would truncate the pipe
    return
  }
  if (isProbe && rig === 'npty-preseed-corrupt') corruptOnDiskPtyNode(resolved[0])

  // npty-race-divergent (0023 REQ-015 amendment): preload the fs-rename interposer in front of
  // the REAL unpacker so its promote collides with a divergent already-promoted install that
  // REAPPEARS after the single replace retry (NPTY_INTERPOSE_EVERY — the amended rename-first
  // promote repairs a one-shot divergence) — the genuine exit-95 path, never a synthetic
  // exit-code injection.
  const raced = !isProbe && rig === 'npty-race-divergent'
  const preArgs = raced
    ? ['--require', fileURLToPath(new URL('npty-race-interpose.cjs', import.meta.url))]
    : []
  const child = spawn(process.execPath, [...preArgs, '-e', script, ...resolved], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    ...(raced ? { env: { ...process.env, NPTY_INTERPOSE_MODE: 'divergent', NPTY_INTERPOSE_EVERY: '1' } } : {})
  })
  child.stderr.pipe(process.stderr)
  child.on('error', (e) => die(12, `failed to run the embedded node -e script locally: ${String(e)}`))

  if (isProbe) {
    // Buffer stdout so the synthesized-triple and rc-noise rigs can rewrite it whole.
    let out = ''
    child.stdout.on('data', (c) => { out += c.toString('utf8') })
    child.on('close', (code) => {
      const tripleEnv = process.env.FAKE_SSH_PROBE_TRIPLE
      if (tripleEnv) {
        const triple = JSON.parse(tripleEnv)
        out = out.split('\n').map((line) => {
          if (!line.startsWith(PROBE_SENTINEL)) return line
          const obj = JSON.parse(line.slice(PROBE_SENTINEL.length))
          if ('platform' in triple) obj.platform = triple.platform
          if ('arch' in triple) obj.arch = triple.arch
          if ('glibc' in triple) obj.glibc = triple.glibc
          return PROBE_SENTINEL + JSON.stringify(obj)
        }).join('\n')
      }
      if (rig === 'npty-probe-noise') {
        out = 'Welcome to fakebox! (motd noise)\nrc: PATH mangled here\n' + out + 'rc: goodbye noise\n'
      }
      process.stdout.write(out)
      if (rig === 'npty-probe-endless') {
        // REQ-026: the sentinel is out — now keep streaming. A correct client settles on the
        // sentinel and tears this child down; a broken one is stopped by the 120 s bound so
        // the suite can fail fast instead of hanging.
        const iv = setInterval(() => {
          try { process.stdout.write('endless probe stdout noise after the sentinel line\n') } catch { process.exit(0) }
        }, 20)
        setTimeout(() => { clearInterval(iv); process.exit(0) }, 120000)
        return
      }
      process.exitCode = code === null ? 1 : code
      process.stdin.destroy()
    })
    process.stdin.pipe(child.stdin) // the probe reads no stdin; harmless passthrough
    return
  }

  // node-pty install: buffer stdin fully so the payload rigs can mutate it deterministically.
  child.stdout.pipe(process.stdout)
  const chunks = []
  process.stdin.on('data', (c) => chunks.push(c))
  process.stdin.on('end', () => {
    let body = Buffer.concat(chunks)
    if (rig.startsWith('npty-truncate:')) {
      const drop = Number(rig.slice('npty-truncate:'.length))
      body = body.subarray(0, Math.max(0, body.length - drop))
    }
    if (rig === 'npty-corrupt') body = corruptPtyNode(body)
    child.stdin.write(body)
    child.stdin.end()
  })
  child.on('close', (code) => {
    process.exitCode = code === null ? 1 : code
  })
}

/** Flip one byte inside the pty.node region of a NODE_PTY_PAYLOAD_V1 stream (header line +
 *  concatenated file bytes in header order) — the sha-mismatch rig (0023 REQ-015). */
function corruptPtyNode(body) {
  const nl = body.indexOf(0x0a)
  if (nl < 0) return body
  let header
  try { header = JSON.parse(body.subarray(0, nl).toString('utf8')) } catch { return body }
  let off = nl + 1
  for (const f of header.files || []) {
    if (String(f.path).endsWith('pty.node')) {
      if (!(f.size > 0)) return body
      const copy = Buffer.from(body)
      copy[off] = copy[off] ^ 0xff
      return copy
    }
    off += f.size
  }
  return body
}
