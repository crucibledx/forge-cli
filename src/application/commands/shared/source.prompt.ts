import type {Source} from '@domain/config/types'
import {SOURCE_LAYOUT_OPTIONS, type SourceLayoutOption} from '@domain/sync/layout'
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
  options: {
    gate: 'Configure advanced source options? (layout/include/exclude/map)',
    layout: {
      message: 'Source layout:',
      options: [
        {
          value: SOURCE_LAYOUT_OPTIONS.AUTO,
          label: 'Auto',
          hint: 'detect from source — handles both canonical and pre-structured',
        },
        {value: SOURCE_LAYOUT_OPTIONS.CANONICAL, label: 'Canonical only', hint: 'skills/, rules/, workflows/'},
        {value: SOURCE_LAYOUT_OPTIONS.PRE_STRUCTURED, label: 'Pre-structured only', hint: '.claude/, .cursor/, etc.'},
      ],
    },
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

export async function configureSource(existing?: Source): Promise<Source> {
  const sourceType = await prompts.select({
    message: SOURCE_PROMPT_MESSAGES.selectType,
    options: getSourceLoaderOptions(),
    initialValue: existing?.type,
  })
  const source = await getSourceLoader(sourceType).configure(existing)
  return promptSourceOptions(source, existing)
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

export async function promptSourceOptions(source: Source, existing?: Source): Promise<Source> {
  const M = SOURCE_PROMPT_MESSAGES.options
  const hasExisting = existing?.layout || existing?.include || existing?.exclude || existing?.map
  const wantsOptions = await prompts.confirm({message: M.gate, initialValue: !!hasExisting})
  if (!wantsOptions) return source

  const layout = (await prompts.select({
    message: M.layout.message,
    options: [...M.layout.options].map((o) => ({
      ...o,
      hint: o.value === (existing?.layout ?? SOURCE_LAYOUT_OPTIONS.AUTO) ? `${o.hint} (current)` : o.hint,
    })),
    initialValue: existing?.layout ?? SOURCE_LAYOUT_OPTIONS.AUTO,
  })) as SourceLayoutOption
  if (layout !== SOURCE_LAYOUT_OPTIONS.AUTO) source.layout = layout

  const includeRaw = await prompts.text({
    message: M.include.message,
    placeholder: M.include.placeholder,
    initialValue: existing?.include?.join(', '),
  })
  const include = parseCommaSeparated(includeRaw)
  if (include.length) source.include = include

  const excludeRaw = await prompts.text({
    message: M.exclude.message,
    placeholder: M.exclude.placeholder,
    initialValue: existing?.exclude?.join(', '),
  })
  const exclude = parseCommaSeparated(excludeRaw)
  if (exclude.length) source.exclude = exclude

  const mapRaw = await prompts.text({
    message: M.map.message,
    placeholder: M.map.placeholder,
    initialValue: existing?.map,
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
