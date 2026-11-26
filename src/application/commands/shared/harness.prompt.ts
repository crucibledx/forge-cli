import type {HarnessConfig, HarnessDefinition, HarnessId, DetectionResult} from '@domain/harnesses'
import {getAllHarnesses} from '@domain/harnesses'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {scanForHarnesses} from '@infrastructure/fs'

// ─── Messages ────────────────────────────────────────────────────────────────

export const HARNESS_PROMPT_MESSAGES = {
  scanning: 'Scanning for AI configs...',
  scanDone: 'Scan complete',
  select: 'Select harnesses to enable:',
  detectedHint: 'detected',
  detectedGlobalHint: 'detected globally',
  noneSelected: 'No harnesses selected.',
} as const

// ─── Scan ────────────────────────────────────────────────────────────────────

export interface HarnessScanResult {
  allHarnesses: readonly HarnessDefinition[]
  detectionResults: DetectionResult[]
}

export function runHarnessScan(projectRoot: string): HarnessScanResult {
  const M = HARNESS_PROMPT_MESSAGES
  const s = prompts.spinner()
  s.start(M.scanning)
  const allHarnesses = getAllHarnesses()
  const detectionResults = scanForHarnesses(projectRoot, allHarnesses)
  s.stop(M.scanDone)
  return {allHarnesses, detectionResults}
}

// ─── Selection ───────────────────────────────────────────────────────────────

export async function promptHarnessSelection(
  scan: HarnessScanResult,
  initialIds: HarnessId[],
): Promise<HarnessConfig[]> {
  const M = HARNESS_PROMPT_MESSAGES
  const {allHarnesses, detectionResults} = scan
  const detectionByHarness = new Map(detectionResults.map((r) => [r.id, r]))

  const selectedIds = await prompts.multiselect({
    message: M.select,
    options: allHarnesses.map((a) => {
      const result = detectionByHarness.get(a.id)
      let hint: string | undefined
      if (result?.detected) {
        hint = result.scope === 'global' ? (result.evidence?.split(', ')[0] ?? M.detectedGlobalHint) : M.detectedHint
      }
      return {value: a.id, label: a.name, hint}
    }),
    initialValues: initialIds,
  })

  if (selectedIds.length === 0) {
    renderer.renderWarning(M.noneSelected)
  }

  return selectedIds.map((id) => ({id: id as HarnessId, enabled: true}))
}
