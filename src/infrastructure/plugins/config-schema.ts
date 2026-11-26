import {z} from 'zod'

import {getAssistantIds} from '@domain/assistants'
import {PLUGIN_HARNESS_IDS, PLUGIN_SCOPES} from '@domain/plugins'

import {PLUGIN_CONFIG_ERRORS as E} from './errors'
import {PLUGIN_NAME, PLUGIN_NAME_MAX} from './manifest'

const REMAP_KEYS = ['layout', 'include', 'exclude', 'map']
const notOption = (value: string) => !value.startsWith('-')
const ABBREVIATED_SHA = /^[0-9a-f]{7,39}$/i
const gitRef = z
  .string()
  .min(1)
  .refine(notOption, 'must not start with a dash')
  .refine((ref) => !ABBREVIATED_SHA.test(ref), `${E.SHORT_SHA}: write the full 40-character commit SHA`)
const repoPath = z
  .string()
  .min(1)
  .refine(
    (path) => !/^(?:[/\\]|[a-z]:)/i.test(path) && !path.split(/[/\\]/).includes('..'),
    'must be a relative path inside the repository',
  )

const sourceSchema = z
  .unknown()
  .superRefine((raw, ctx) => {
    if (typeof raw !== 'object' || raw === null) return
    for (const key of REMAP_KEYS)
      if (key in raw)
        ctx.addIssue({
          code: 'custom',
          message: `${E.REMAP}: "${key}" is not allowed on a plugin source; a plugin package is self-describing`,
        })
    if ('branch' in raw && 'ref' in raw)
      ctx.addIssue({code: 'custom', message: `${E.REF_CONFLICT}: write "ref" or the deprecated "branch", not both`})
  })
  .pipe(
    z.discriminatedUnion('type', [
      z.object({type: z.literal('local'), path: z.string().min(1)}).strict(),
      z
        .object({
          type: z.literal('git'),
          url: z.string().min(1).refine(notOption, 'must not start with a dash'),
          path: repoPath.optional(),
          ref: gitRef.optional(),
          branch: gitRef.optional(),
        })
        .strict(),
    ]),
  )

export const pluginConfigSchema = z
  .object({
    name: z.string().max(PLUGIN_NAME_MAX).regex(PLUGIN_NAME, 'must be an Agent Plugins name'),
    source: sourceSchema,
    harnesses: z
      .array(z.string())
      .superRefine((ids, ctx) => {
        const known = [...new Set([...getAssistantIds(), ...PLUGIN_HARNESS_IDS])].sort()
        for (const id of ids.filter((id) => !known.includes(id)))
          ctx.addIssue({code: 'custom', message: `${E.UNKNOWN_HARNESS}: "${id}"; expected one of ${known.join(', ')}`})
      })
      .optional(),
    scope: z.enum([PLUGIN_SCOPES.PROJECT, PLUGIN_SCOPES.USER]).optional(),
  })
  .strict()

/** Parsed as written, with no defaults applied: the config writer re-serializes what it loaded. */
export const pluginsConfigSchema = z.array(pluginConfigSchema).superRefine((plugins, ctx) => {
  const seen = new Set<string>()
  for (const plugin of plugins) {
    if (seen.has(plugin.name)) ctx.addIssue({code: 'custom', message: `Duplicate plugin name: ${plugin.name}`})
    seen.add(plugin.name)
  }
})
