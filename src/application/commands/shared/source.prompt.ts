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
  filters: {
    gate: 'Configure advanced filtering? (include/exclude/map)',
    include: {
      message: 'Include patterns (comma-separated globs, empty to skip):',
      placeholder: 'skills/**, rules/**',
    },
    exclude: {
      message: 'Exclude patterns (comma-separated globs, empty to skip):',
      placeholder: '.internal/**, **/draft-*',
    },
    map: {
      message: 'Map prefix (virtual directory to prepend, empty to skip):',
      placeholder: 'skills',
    },
  },
} as const

// ─── Prompts ─────────────────────────────────────────────────────────────────

export async function configureSource(): Promise<Source> {
  const sourceType = await prompts.select({
    message: SOURCE_PROMPT_MESSAGES.selectType,
    options: getSourceLoaderOptions(),
  })
  const source = await getSourceLoader(sourceType).configure()
  return promptSourceFilters(source)
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

export async function promptSourceFilters(source: Source): Promise<Source> {
  const M = SOURCE_PROMPT_MESSAGES.filters
  const wantsFilters = await prompts.confirm({message: M.gate, initialValue: false})
  if (!wantsFilters) return source

  const includeRaw = await prompts.text({
    message: M.include.message,
    placeholder: M.include.placeholder,
  })
  const include = parseCommaSeparated(includeRaw)
  if (include.length) source.include = include

  const excludeRaw = await prompts.text({
    message: M.exclude.message,
    placeholder: M.exclude.placeholder,
  })
  const exclude = parseCommaSeparated(excludeRaw)
  if (exclude.length) source.exclude = exclude

  const mapRaw = await prompts.text({
    message: M.map.message,
    placeholder: M.map.placeholder,
  })
  const map = mapRaw?.trim()
  if (map) source.map = map

  return source
}

function parseCommaSeparated(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
