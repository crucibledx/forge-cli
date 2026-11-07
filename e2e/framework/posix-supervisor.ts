import {closeSync} from 'node:fs'

// This process is the durable group leader, not the test runner. Even SIGKILL of
// that runner closes IPC and leaves this owner alive to reap resistant children.
let disposing = false
function dispose() {
  if (disposing) return
  disposing = true
  process.kill(-process.pid, 'SIGTERM')
  setTimeout(() => process.kill(-process.pid, 'SIGKILL'), 500)
}
process.on('SIGTERM', dispose)
process.on('SIGINT', () => {}) // The foreground child owns interactive cancellation.
process.on('disconnect', dispose)
setInterval(() => {}, 1000)
if (process.connected === false) dispose()
else {
  const command: string[] = JSON.parse(Bun.argv[2])
  const child = Bun.spawn(command, {stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', env: process.env})
  const code = await child.exited
  const members = Bun.spawnSync(['ps', '-axo', 'pid=,pgid=,stat='], {stdout: 'pipe', stderr: 'pipe', env: process.env})
  const remaining = new TextDecoder()
    .decode(members.stdout)
    .split('\n')
    .some((line) => {
      const [pid, group, state] = line.trim().split(/\s+/)
      return (
        Number(group) === process.pid && ![process.pid, members.pid].includes(Number(pid)) && !state?.startsWith('Z')
      )
    })
  process.send?.({forgeOwnedExit: true, code, signal: child.signalCode, keepOwner: members.exitCode !== 0 || remaining})
  // Inspect/send before closing stdio: spawning ps after closing0/1/2 can reuse
  // Bun's registered stream FDs and prevent normal exit notification.
  for (const fd of [0, 1, 2]) {
    try {
      closeSync(fd)
    } catch {}
  }
  // Fast successful commands need no grace delay; surviving descendants retain
  // their owner until the session disposes it or its runner disappears.
  if (members.exitCode === 0 && !remaining) process.exit(code)
}
