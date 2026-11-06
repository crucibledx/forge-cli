// No third-party imports: this must run after frozen dependency installation fails.
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {rawValidationContext, repositoryRoot} from './validation-identity'
import {laneById} from './validation-lanes'

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--lane') throw new Error('Expected --lane <id>')
  const lane = laneById(args[1])
  const context = rawValidationContext()
  const directory = join(repositoryRoot, 'results')
  const reason = 'Toolchain/dependency installation failed; dependent check was not executed'
  const checks = []
  for (const check of lane.checks) {
    const ref = `checks/${lane.id}/${check.id.replaceAll(':', '-')}.log`
    await mkdir(join(directory, 'checks', lane.id), {recursive: true})
    await writeFile(join(directory, ref), JSON.stringify({command: check.command, exit_code: null, reason}) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
    checks.push({
      id: check.id,
      command: check.command.join(' '),
      exit_code: null,
      duration_ms: 0,
      evidence: [ref],
      reason,
    })
  }
  await writeFile(join(directory, 'context.json'), JSON.stringify(context) + '\n', {flag: 'wx', mode: 0o600})
  await writeFile(
    join(directory, `${lane.id}.json`),
    JSON.stringify({
      schema_version: 1,
      head_sha: context.head_sha,
      tested_sha: context.tested_sha,
      run_id: context.run_id,
      run_attempt: context.run_attempt,
      lane_id: lane.id,
      status: 'blocked',
      runner_os: process.platform,
      bun_version: Bun.version,
      duration_ms: 0,
      checks,
    }) + '\n',
    {flag: 'wx', mode: 0o600},
  )
  console.error(
    `Installation failed with pinned Bun${(await readFile(join(repositoryRoot, '.bun-version'), 'utf8')).trim()}; ${lane.id} checks blocked`,
  )
}
