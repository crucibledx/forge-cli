import {z} from 'zod'

import {SOURCE_LAYOUT_VALUES} from '@domain/sync/layout'

export const gitSourceSchema = z.object({
  name: z.string(),
  type: z.literal('git'),
  url: z.string(),
  branch: z.string().default('main'),
  path: z.string().optional(),
  layout: z.enum(SOURCE_LAYOUT_VALUES).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  map: z.string().optional(),
})
