// FROZEN test fixture — feature 0020-ssh-tunnel-provisioned-bootstrap (phase 4).
//
// The fake `ssh` shim (REQ-018): a stand-in for the system OpenSSH binary, spawned by the
// remote-client spawn seam as `process.execPath + [thisFile, ...realSshArgv]`. It accepts the
// REAL builder-produced argv (`[-p PORT] [-i IDENTITY] user@host <one remote command string>`),
// consults an env-configured fake remote home, and emulates EXACTLY the two remote command
// shapes the spec pins (the REQ-009 launch probe and the REQ-012 upload) with Node fs /
// child_process primitives — no POSIX shell, so it runs on windows-latest CI; no network
// modules, ever (a structural test scans this file). The agent, when "launched", runs as a
// LOCAL child process — the identical protocol path production runs over ssh (locked
// decision 1).
//
// Env contract (all rig switches are env-driven — deterministic, REQ-018):
//   FAKE_SSH_HOME      (required) directory acting as the remote $HOME; `~/` resolves here.
//   FAKE_SSH_LOG       (optional) append one JSON line {kind, destination, command} per
//                      invocation — the CONV-051-scoped invocation ledger tests count.
//   FAKE_SSH_RIG       (optional) failure rigs:
//                        'exit255'      — behave like an ssh transport/auth failure: write a
//                                         diagnostic to stderr, exit 255 before interpreting.
//                        'stall'        — log, then hold the connection open forever (never
//                                         output, never exit) until killed — abort-path rig.
//                        'ignore-upload'— launch behaves normally; an upload consumes stdin,
//                                         reports success (exit 0) but writes NOTHING.
//                        'truncate:<n>' — an upload receives only the first <n> bytes (the
//                                         remote wc -c check must then fail → rm tmp, exit 93).
//
// Exit codes mirror the spec sentinels: 127 launch-absent (REQ-009), 93 upload-not-promoted
// (REQ-012), 255 transport rig, 12 = shim-level argv/command parse error (a test bug, never a
// legitimate outcome).
import { existsSync, mkdirSync, appendFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { resolve as resolvePath, dirname, sep } from 'node:path'
import { spawn } from 'node:child_process'

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

const kindOf = (cmd) => (cmd.startsWith('test -f ') ? 'launch' : cmd.startsWith('mkdir -p ') ? 'upload' : 'other')

if (process.env.FAKE_SSH_LOG) {
  appendFileSync(process.env.FAKE_SSH_LOG,
    JSON.stringify({ kind: kindOf(command), destination, command }) + '\n')
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

function interpret() {
  // ---- REQ-009 launch probe: test -f P && exec node P --pty=B || exit 127 ----------------
  const launch = command.match(/^test -f (\S+) && exec node \1 --pty=(node-pty|fake) \|\| exit 127$/)
  if (launch) {
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

  die(12, `unrecognized remote command shape: ${command}`)
}
