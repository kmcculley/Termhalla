// A deterministic MARKER-LESS interactive "remote shell" for the e2e harness — the stand-in for
// what an `ssh` launch override actually gives the status engine: a pane with NO shell-integration
// injection and NO OSC 133 markers, whose ONLY busy signal is real printable output
// (StatusTracker's `!hasMarkers` path). Spawned in-app as a pane `launch` override
// (`{ command: node, args: [this file] }` — the verbatim-spawn path ssh launches ride), so the
// full chain node-pty → ConPTY → status tail → pane chip runs against a genuinely marker-less
// interactive child. Deliberately tiny and dependency-free; emits NOTHING but printable text.
//
// Commands (a line terminated by Enter; ConPTY cooks input, so lines arrive whole):
//   echo <text>  -> <text>
//   ask          -> prints `Overwrite? [y/N] ` with NO newline (the needs-input tail pattern);
//                   the next line is consumed as the answer -> `answered: <line>`
//   exit [code]  -> exits
//   anything     -> `fakebox: unknown: <line>`
const PROMPT = 'fakebox$ '

process.stdout.write('fakebox marker-less shell\r\n')
process.stdout.write(PROMPT)

let buf = ''
let pendingAsk = false

const handle = (line) => {
  if (pendingAsk) {
    pendingAsk = false
    process.stdout.write(`answered: ${line}\r\n${PROMPT}`)
    return
  }
  if (line.startsWith('echo ')) {
    process.stdout.write(`${line.slice(5)}\r\n${PROMPT}`)
  } else if (line === 'ask') {
    pendingAsk = true
    process.stdout.write('Overwrite? [y/N] ')
  } else if (line === 'exit' || line.startsWith('exit ')) {
    const code = Number(line.slice(5))
    process.exit(Number.isInteger(code) && code >= 0 ? code : 0)
  } else if (line === '') {
    process.stdout.write(PROMPT)
  } else {
    process.stdout.write(`fakebox: unknown: ${line}\r\n${PROMPT}`)
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => {
  buf += c
  let nl = buf.search(/[\r\n]/)
  while (nl !== -1) {
    const raw = buf.slice(0, nl)
    buf = buf.slice(buf[nl] === '\r' && buf[nl + 1] === '\n' ? nl + 2 : nl + 1)
    handle(raw.trim())
    nl = buf.search(/[\r\n]/)
  }
})
process.stdin.on('end', () => process.exit(0))
