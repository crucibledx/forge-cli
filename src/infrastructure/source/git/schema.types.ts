import {z} from 'zod'

export const gitSourceSchema = z.object({
  name: z.string(),
  type: z.literal('git'),
  url: z.string(),
  branch: z.string().default('main'),
  path: z.string().optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  map: z.string().optional(),
})
