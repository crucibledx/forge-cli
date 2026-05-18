import {z} from 'zod'

const gitAuthSchema = z.object({
  type: z.enum(['ssh-key', 'token']),
  keyPath: z.string().optional(),
  token: z.string().optional(),
})

export const gitSourceSchema = z.object({
  name: z.string(),
  type: z.literal('git'),
  url: z.string(),
  branch: z.string().default('main'),
  path: z.string().optional(),
  auth: gitAuthSchema.optional(),
})
