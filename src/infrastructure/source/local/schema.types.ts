import {z} from 'zod'

export const localSourceSchema = z.object({
  name: z.string(),
  type: z.literal('local'),
  path: z.string(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  map: z.string().optional(),
})
