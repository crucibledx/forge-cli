import {z} from 'zod'

export const localSourceSchema = z.object({
  name: z.string(),
  type: z.literal('local'),
  path: z.string(),
})
