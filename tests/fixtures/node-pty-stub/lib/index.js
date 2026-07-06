// Test fixture — feature 0023-remote-node-pty-prebuilt (phase 4, REQ-020).
//
// A pure-JS stub implementing EXACTLY the node-pty surface src/agent/node-pty-backend.ts
// touches (spawn/write/resize/kill/pause/resume/onData/onExit — see the NodePtyProc mirror
// there): a scripted echo pty. It lets the REAL agent bundle, launched with --pty=node-pty,
// resolve the bare specifier 'node-pty' from <agentDir>/node_modules/node-pty and serve a
// pty round trip on windows-latest with zero native code (locked testing posture).
//
// Behavior: on spawn the "pty" emits one 'stub-ready\n' line; every write(data) is echoed
// back verbatim through onData; kill() fires onExit with exitCode 0.
'use strict'

function spawn(file, args, options) {
  let dataCb = () => {}
  let exitCb = () => {}
  let paused = false
  const queue = []
  const emit = (s) => {
    if (paused) { queue.push(s); return }
    dataCb(s)
  }
  setImmediate(() => emit('stub-ready\n'))
  return {
    write: (data) => { setImmediate(() => emit(String(data))) },
    resize: (_cols, _rows) => {},
    kill: (_signal) => { setImmediate(() => exitCb({ exitCode: 0 })) },
    pause: () => { paused = true },
    resume: () => {
      paused = false
      while (queue.length > 0 && !paused) dataCb(queue.shift())
    },
    onData: (cb) => { dataCb = cb },
    onExit: (cb) => { exitCb = cb }
  }
}

module.exports = { spawn }
