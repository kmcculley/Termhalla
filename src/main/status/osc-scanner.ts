/** Scan `buf` for OSC sequences that begin with `prefix` (e.g. '\x1b]133;' for OSC 133
 *  markers, or '\x1b]' for any OSC). Each complete sequence's body (the text between the
 *  prefix and its BEL/ST terminator) is passed to `onBody`. Returns the unconsumed tail to
 *  carry over to the next chunk: a partial sequence still awaiting its terminator, or '' when
 *  nothing is pending. Shared by Osc133Parser and CwdParser — the accumulate / find-prefix /
 *  locate-terminator / slice-body / trim-carryover loop is identical for both; only the body
 *  handling differs, so keeping it in one place avoids the two copies drifting. */
export function scanOsc(buf: string, prefix: string, onBody: (body: string) => void): string {
  while (true) {
    const start = buf.indexOf(prefix)
    if (start === -1) break
    const from = start + prefix.length
    const bel = buf.indexOf('\x07', from)
    const st = buf.indexOf('\x1b\\', from)
    let end = -1, termLen = 0
    if (bel !== -1 && (st === -1 || bel < st)) { end = bel; termLen = 1 }
    else if (st !== -1) { end = st; termLen = 2 }
    if (end === -1) return buf.slice(start)   // incomplete sequence; carry it over
    onBody(buf.slice(from, end))
    buf = buf.slice(end + termLen)
  }
  // No full prefix pending. Keep a trailing partial ESC-prefix (e.g. a lone '\x1b]1') so a
  // sequence split mid-prefix across chunks still parses once the rest arrives.
  const lastEsc = buf.lastIndexOf('\x1b')
  return lastEsc !== -1 && prefix.startsWith(buf.slice(lastEsc)) ? buf.slice(lastEsc) : ''
}
