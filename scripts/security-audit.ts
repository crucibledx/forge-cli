import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import {z} from 'zod'

import {hashContent} from '../src/domain/sync/state'
import {repositoryRoot} from './validation-identity'
import type {CommandOutcome} from './validation-process'
import {executeCheck} from './validation-process'

const advisory = z
  .object({
    id: z.number().int().positive(),
    url: z.url().refine((url) => /^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9-]+$/.test(url)),
    title: z.string().min(1),
    severity: z.enum(['low', 'moderate', 'high', 'critical']),
    vulnerable_versions: z.string().min(1),
    cwe: z.array(z.string()),
    cvss: z.object({score: z.number().min(0).max(10), vectorString: z.string().nullable()}).strict(),
  })
  .strict()
export function assessAudit(result: CommandOutcome, lockUnchanged: boolean) {
  const blocked = (reason: string) => ({status: 'blocked' as const, exit_code: 2, reason})
  if (!lockUnchanged) return blocked('Lockfile changed during audit')
  let data: Record<string, z.infer<typeof advisory>[]>
  try {
    data = z.record(z.string().min(1), z.array(advisory).min(1)).parse(JSON.parse(result.stdout))
  } catch {
    return blocked('Invalid advisory JSON or unaudited-package result')
  }
  const high = Object.entries(data).flatMap(([name, advisories]) =>
    advisories
      .filter((item) => ['high', 'critical'].includes(item.severity))
      .map((item) => ({package: name, id: item.id, severity: item.severity, url: item.url})),
  )
  if (high.length)
    return {
      status: 'fail' as const,
      exit_code: 1,
      reason: 'High/critical dependency advisories, including development dependencies',
      advisories: high,
      ...([result.reason, result.stderr.trim(), result.exit_code === null ? 'Process exit unavailable' : ''].some(
        Boolean,
      )
        ? {
            diagnostic: [
              result.reason,
              result.stderr.trim(),
              result.exit_code === null ? 'Process exit unavailable' : '',
            ]
              .filter(Boolean)
              .join('; '),
          }
        : {}),
    }
  if (result.exit_code === null) return blocked(result.reason ?? 'Advisory service unavailable')
  if (result.timed_out || result.reason) return blocked(result.reason ?? 'Advisory service unavailable')
  if (result.stderr.trim()) return blocked('Unexpected advisory diagnostic; audited package completeness is unproven')
  if (result.exit_code !== 0) return blocked('Audit exited unsuccessfully without a valid blocking advisory')
  return {
    status: 'pass' as const,
    exit_code: 0,
    reason: 'Complete advisory response, no high/critical findings; lower-severity findings remain visible',
    advisory_data: data,
  }
}
async function audit() {
  const lock = resolve(repositoryRoot, 'bun.lock')
  const hash = async () => hashContent(await readFile(lock))
  const before = await hash()
  const result = await executeCheck(['bun', 'audit', '--json', '--audit-level=high'], 60000)
  return assessAudit(result, before === (await hash()))
}
if (import.meta.main) {
  try {
    const result = await audit()
    console.log(JSON.stringify(result))
    process.exitCode = result.exit_code
  } catch {
    console.error('Dependency audit unavailable; no clean audit is claimed')
    process.exitCode = 2
  }
}
