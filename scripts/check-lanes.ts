import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import {redact} from '../src/domain/redact'
import {readEvidence, writeEvidence} from './evidence-io'
import type {EvidenceContext, LaneEvidence} from './evidence-schema'
import {contextSchema, laneSchema} from './evidence-schema'
import {repositoryRoot, validationContext} from './validation-context'
import {checkEvidencePath} from './validation-evidence'
import type {ValidationCheck, ValidationLane} from './validation-lanes'
import {CI_EVIDENCE_RESERVE_MS, LANE_BUDGET_MS, laneById, validationLanes} from './validation-lanes'
import {aggregateExit, assessLane, blockedExit, failedExit} from './validation-policy'
import type {CommandOutcome} from './validation-process'
import {commandLog, commandMetadata, commandReason, executeCheck} from './validation-process'

const logPath = checkEvidencePath
const resultPath = (lane: string, check: string) => `${logPath(lane, check)}.json`
export function remainingCIBudget(lane: ValidationLane, startedAt: string | undefined, now = Date.now()): number {
  if (!startedAt || !/^\d+$/.test(startedAt)) return 0
  const start = Number(startedAt) * 1000
  if (!Number.isSafeInteger(start) || start <= 0 || start > now) return 0
  return Math.max(0, Math.min(lane.timeout_ms, LANE_BUDGET_MS) - (now - start) - CI_EVIDENCE_RESERVE_MS)
}
async function runCheck(
  out: string,
  lane: ValidationLane,
  check: ValidationCheck,
  budget: number,
  executor: typeof executeCheck,
  blocked?: string,
) {
  let result: CommandOutcome =
    blocked || budget <= 0
      ? {
          ...commandMetadata(),
          exit_code: null,
          duration_ms: 0,
          timed_out: false,
          stdout: '',
          stderr: '',
          reason: blocked ?? 'Lane deadline exhausted',
        }
      : {...commandMetadata(), exit_code: null, duration_ms: 0, timed_out: false, stdout: '', stderr: ''}
  if (!blocked && budget > 0) {
    const start = performance.now()
    try {
      result = await executor(check.command, budget)
    } catch (error) {
      result.duration_ms = performance.now() - start
      result.reason = `Validator setup/execution unavailable: ${String(error)}`
    }
  }
  if (result.reason) result = {...result, reason: commandReason(result.reason)}
  const evidence = logPath(lane.id, check.id)
  await mkdir(resolve(out, 'checks', lane.id), {recursive: true, mode: 0o700})
  await writeFile(resolve(out, evidence), commandLog(check.command, result) + '\n', {
    mode: 0o600,
  })
  const reason =
    result.reason ??
    (blockedExit(result.exit_code, check) ? 'Command reports incomplete/unavailable validation' : undefined)
  const record = {
    id: check.id,
    command: check.command.join(' '),
    exit_code: result.exit_code,
    duration_ms: result.duration_ms,
    evidence: [evidence],
    ...(reason ? {reason} : {}),
  }
  return record
}
function laneResult(
  context: EvidenceContext,
  lane: ValidationLane,
  checks: LaneEvidence['checks'],
  duration: number,
  platform: NodeJS.Platform,
): LaneEvidence {
  const status = checks.some((check) =>
    failedExit(
      check.exit_code,
      lane.checks.find((expected) => expected.id === check.id)!,
    ),
  )
    ? 'fail'
    : checks.some((check) => check.exit_code !== 0)
      ? 'blocked'
      : 'pass'
  return laneSchema.parse({
    schema_version: 1,
    head_sha: context.head_sha,
    tested_sha: context.tested_sha,
    run_id: context.run_id,
    run_attempt: context.run_attempt,
    lane_id: lane.id,
    status,
    runner_os: platform,
    bun_version: Bun.version,
    duration_ms: duration,
    checks,
  })
}
export async function runLanes(
  out: string,
  context: EvidenceContext,
  executor = executeCheck,
  platform = process.platform,
): Promise<LaneEvidence[]> {
  const reports: LaneEvidence[] = []
  let cursor = 0
  await writeEvidence(resolve(out, 'context.json'), context)
  await Promise.all(
    [0, 1].map(async () => {
      while (cursor < validationLanes.length) {
        const lane = validationLanes[cursor++],
          start = performance.now()
        const checks = []
        const blocked =
          lane.platform && lane.platform !== platform
            ? `Requires native ${lane.platform}; this host is ${platform}`
            : undefined
        for (const check of lane.checks)
          checks.push(
            await runCheck(out, lane, check, lane.timeout_ms - (performance.now() - start), executor, blocked),
          )
        const report = laneResult(context, lane, checks, performance.now() - start, platform)
        await writeEvidence(resolve(out, `${lane.id}.json`), report)
        reports.push(report)
      }
    }),
  )
  return validationLanes.map((lane) => reports.find((report) => report.lane_id === lane.id)!)
}
export async function lanesCLI(args: string[]): Promise<number> {
  if (args[0] === '--') args = args.slice(1)
  let out = resolve(repositoryRoot, 'results'),
    selected: string | undefined,
    index: number | undefined,
    assemble = false
  while (args.length) {
    const flag = args.shift()
    if (flag === '--out') out = resolve(args.shift()!)
    else if (flag === '--lane') selected = args.shift()
    else if (flag === '--check-index') index = Number(args.shift())
    else if (flag === '--assemble') assemble = true
    else throw new Error(`Unknown lane argument: ${flag}`)
  }
  const context = validationContext()
  if (!selected) {
    const reports = await runLanes(out, context)
    console.log(JSON.stringify(reports.map(({lane_id, status}) => ({lane_id, status}))))
    return aggregateExit(reports)
  }
  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('Single-step lane execution requires trusted CI context; use check:lanes locally')
  const lane = laneById(selected)
  const pin = (await readFile(resolve(repositoryRoot, '.bun-version'), 'utf8')).trim()
  await writeEvidence(resolve(out, 'context.json'), context)
  if (assemble) {
    const checks = []
    for (const check of lane.checks) {
      try {
        const partial = JSON.parse(await readEvidence(out, resultPath(lane.id, check.id)))
        contextSchema.parse(partial.context)
        if (JSON.stringify(partial.context) !== JSON.stringify(context)) throw new Error('Stale check identity')
        checks.push(partial.check)
      } catch {
        checks.push(await runCheck(out, lane, check, 0, executeCheck, 'Missing/invalid independent check result'))
      }
    }
    const report = assessLane(
      laneResult(
        context,
        lane,
        checks,
        checks.reduce((sum, check) => sum + check.duration_ms, 0),
        process.platform,
      ),
      context,
      pin,
    )
    await writeEvidence(resolve(out, `${lane.id}.json`), report)
    return aggregateExit([report])
  }
  if (index === undefined || !Number.isInteger(index) || index < 0 || index > 3)
    throw new Error('Expected check index 0..3')
  const check = lane.checks[index]
  if (!check) return 0
  const result = await runCheck(
    out,
    lane,
    check,
    remainingCIBudget(lane, process.env.FORGE_LANE_STARTED_AT),
    executeCheck,
    lane.platform && lane.platform !== process.platform ? `Requires native ${lane.platform}` : undefined,
  )
  await writeEvidence(resolve(out, resultPath(lane.id, check.id)), {context, check: result})
  return result.exit_code ?? 2
}
if (import.meta.main) {
  try {
    process.exitCode = await lanesCLI(Bun.argv.slice(2))
  } catch (error) {
    console.error(redact(String(error)))
    process.exitCode = 2
  }
}
