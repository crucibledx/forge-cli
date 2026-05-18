import type {Source} from '@domain/config/types'
import * as prompts from '@infrastructure/cli/prompts'
import {getSourceLoader, getSourceLoaderOptions} from '@infrastructure/source'

// ─── Messages ────────────────────────────────────────────────────────────────

export const SOURCE_PROMPT_MESSAGES = {
  selectType: 'Source type:',
} as const

// ─── Prompts ─────────────────────────────────────────────────────────────────

export async function configureSource(): Promise<Source> {
  const sourceType = await prompts.select({
    message: SOURCE_PROMPT_MESSAGES.selectType,
    options: getSourceLoaderOptions(),
  })
  return getSourceLoader(sourceType).configure()
}

export async function promptNewSource(existingCount: number): Promise<Source> {
  const source = await configureSource()
  if (existingCount > 0) {
    source.name = `source-${existingCount + 1}`
  }
  return source
}
