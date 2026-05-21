import type {Source} from '@domain/config/types'
import * as prompts from '@infrastructure/cli/prompts'
import {getSourceLoader, getSourceLoaderOptions} from '@infrastructure/source'

// ─── Messages ────────────────────────────────────────────────────────────────

export const SOURCE_PROMPT_MESSAGES = {
  selectType: 'Source type:',
  name: {
    message: 'Source name:',
    placeholder: (n: number) => (n === 0 ? 'default' : `source-${n + 1}`),
    required: 'Source name is required',
    duplicate: (name: string) => `Source "${name}" already exists`,
  },
} as const

// ─── Prompts ─────────────────────────────────────────────────────────────────

export async function configureSource(): Promise<Source> {
  const sourceType = await prompts.select({
    message: SOURCE_PROMPT_MESSAGES.selectType,
    options: getSourceLoaderOptions(),
  })
  return getSourceLoader(sourceType).configure()
}

export async function promptNewSource(existingNames: string[] = []): Promise<Source> {
  const M = SOURCE_PROMPT_MESSAGES.name
  const defaultName = M.placeholder(existingNames.length)

  const name = await prompts.text({
    message: M.message,
    placeholder: defaultName,
    defaultValue: defaultName,
    validate: (val) => {
      const trimmed = val?.trim()
      if (!trimmed) return undefined
      if (existingNames.includes(trimmed)) return M.duplicate(trimmed)
      return undefined
    },
  })

  const source = await configureSource()
  source.name = name.trim()
  return source
}
