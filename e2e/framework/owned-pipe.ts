import {readFileSync} from 'node:fs'
import {join} from 'node:path'

import {activeProcesses} from './process'
import {createWindowsJob, windowsJobs} from './windows-job'

export type PipeProcess = Pick<
  Bun.Subprocess<'pipe', 'pipe', 'pipe'>,
  'pid' | 'exited' | 'kill' | 'exitCode' | 'signalCode' | 'stdout' | 'stderr'
>
export function windowsArgument(argument: string): string {
  if (!argument || /[\s"]/.test(argument))
    return `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, (slashes) => slashes + slashes)}"`
  return argument
}
export async function spawnOwnedPipe(
  command: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<PipeProcess> {
  if (process.platform !== 'win32')
    return Bun.spawn(command, {cwd, env, detached: true, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe'})
  const executable = Bun.which(command[0], {PATH: env.PATH}) ?? command[0]
  const powershell = join(
    env.SystemRoot ?? env.SYSTEMROOT ?? env.WINDIR ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  )
  const job = await createWindowsJob()
  const base64 = (value: string) =>
    `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value).toString('base64')}'))`
  const bootstrap = readFileSync(join(import.meta.dir, 'windows-launcher.ps1'), 'utf8')
  const invocation = `\n[Environment]::Exit([ForgeOwnedProcess]::Run(${[executable, [executable, ...command.slice(1)].map(windowsArgument).join(' '), cwd, job.name].map(base64).join(',')}))`
  let proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | undefined
  let disposal: Promise<void> | undefined
  const launchOwner = {
    dispose() {
      return (disposal ??= (async () => {
        try {
          job.terminate()
          if (proc) {
            proc.kill()
            await proc.exited
          }
        } finally {
          if (proc) windowsJobs.delete(proc.pid)
          job.close()
        }
      })())
    },
  }
  try {
    proc = Bun.spawn(
      [
        powershell,
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(bootstrap + invocation, 'utf16le').toString('base64'),
      ],
      {cwd, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe'},
    )
    activeProcesses.add(launchOwner)
    windowsJobs.set(proc.pid, job)
    job.assign(proc.pid)
    proc.stdin.write('forge-owned-go\n')
    await proc.stdin.flush()
    await proc.stdin.end()
    if (disposal) throw new Error('Windows process launch was cancelled')
    return proc
  } catch (error) {
    await launchOwner.dispose()
    throw error
  } finally {
    activeProcesses.delete(launchOwner)
  }
}
