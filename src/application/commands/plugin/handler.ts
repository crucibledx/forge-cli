import {resolve} from 'node:path'

import type {PortabilityEntry} from '@domain/plugins'
import {portabilityReport} from '@domain/plugins'
import * as renderer from '@infrastructure/cli/renderer'
import {checkPluginDirectory} from '@infrastructure/plugins'

import {CommandError} from '../types'
import {PLUGIN_MESSAGES as M} from './messages'

export async function runPlugin(): Promise<void> {
  throw new CommandError(M.missingSubcommand, M.missingSubcommandHint)
}

export async function runPluginValidate(path: string | undefined, options: {json?: boolean}): Promise<void> {
  const shown = path ?? '.'
  const check = await checkPluginDirectory(resolve(process.cwd(), shown))
  const portability: Record<string, PortabilityEntry[]> = check.pkg ? portabilityReport(check.pkg) : {}
  if (options.json) {
    const result = {
      valid: !check.errors.length,
      name: check.pkg?.manifest.name ?? null,
      version: check.pkg?.manifest.version ?? null,
      errors: check.errors,
      warnings: check.warnings,
      portability,
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    if (check.errors.length) process.exitCode = 1
    return
  }
  check.warnings.forEach(renderer.renderWarning)
  if (!check.pkg) {
    check.errors.forEach((error) => renderer.renderError(error))
    throw new CommandError(M.validate.invalid(shown), M.validate.invalidHint)
  }
  renderer.renderSuccess(M.validate.valid(check.pkg.manifest.name, check.pkg.manifest.version))
  for (const [harness, entries] of Object.entries(portability)) {
    renderer.render(M.validate.portability(harness))
    if (!entries.length) renderer.renderDim(`  ${M.validate.allNative}`)
    for (const entry of entries) renderer.render(`  ${entry.status} ${entry.kind} ${entry.name}: ${entry.detail}`)
  }
}
