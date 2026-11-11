import {closeSync} from 'node:fs'

// Matches terminateTree's cleanup budget; the supervisor has no session deadline of its own.
const PROBE_MS = 2_000

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
  const keepOwner = await ownedMembersRemain()
  process.send?.({forgeOwnedExit: true, code, signal: child.signalCode, keepOwner})
  // Inspect/send before closing stdio: spawning ps after closing0/1/2 can reuse
  // Bun's registered stream FDs and prevent normal exit notification.
  for (const fd of [0, 1, 2]) {
    try {
      closeSync(fd)
    } catch {}
  }
  // Fast successful commands need no grace delay; surviving descendants retain
  // their owner until the session disposes it or its runner disappears.
  if (!keepOwner) process.exit(code)
}

/** True unless a bounded snapshot proves no other live member remains in this group. */
async function ownedMembersRemain(): Promise<boolean> {
  // The probe stays in this group: if it stalls, the session's group cleanup
  // reaps it and its descendants, and the timer keeps the SIGTERM/disconnect
  // handlers responsive while it runs.
  let probe: Bun.Subprocess<'ignore', 'pipe', 'ignore'> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    probe = Bun.spawn(['ps', '-axo', 'pid=,pgid=,stat='], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
      env: process.env,
    })
    const expired = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), PROBE_MS)
    })
    const snapshot = await Promise.race([Promise.all([new Response(probe.stdout).text(), probe.exited]), expired])
    // An expired or failed snapshot keeps the owner, so the session's cleanup must verify the group itself.
    if (!snapshot || snapshot[1] !== 0) return true
    const own = [process.pid, probe.pid]
    return snapshot[0].split('\n').some((line) => {
      const [pid, group, state] = line.trim().split(/\s+/)
      return Number(group) === process.pid && !own.includes(Number(pid)) && !state?.startsWith('Z')
    })
  } catch {
    return true
  } finally {
    clearTimeout(timer)
    if (probe && probe.exitCode === null && probe.signalCode === null) probe.kill('SIGKILL')
  }
}
