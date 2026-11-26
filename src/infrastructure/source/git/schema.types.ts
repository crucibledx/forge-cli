import {z} from 'zod'

import {SOURCE_LAYOUT_VALUES} from '@domain/sync/layout'

import {GIT_SOURCE_MESSAGES} from './messages'

/** git parses a positional argument that starts with "-" as an option, whatever follows it. */
export const isOptionLike = (value: string) => value.startsWith('-')

export const gitSourceSchema = z.object({
  name: z.string(),
  type: z.literal('git'),
  url: z.string().refine((v) => !isOptionLike(v), {message: GIT_SOURCE_MESSAGES.optionLike('url')}),
  branch: z
    .string()
    .refine((v) => !isOptionLike(v), {message: GIT_SOURCE_MESSAGES.optionLike('branch')})
    .default('main'),
  path: z.string().optional(),
  layout: z.enum(SOURCE_LAYOUT_VALUES).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  map: z.string().optional(),
})
