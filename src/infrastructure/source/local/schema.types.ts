import {z} from 'zod'

import {SOURCE_LAYOUT_VALUES} from '@domain/sync/layout'

export const localSourceSchema = z.object({
  name: z.string(),
  type: z.literal('local'),
  path: z.string(),
  layout: z.enum(SOURCE_LAYOUT_VALUES).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  map: z.string().optional(),
})
