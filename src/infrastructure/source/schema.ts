import {z} from 'zod'

import type {Source} from '@domain/config/types'

import {loadersRegistry} from './registry'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schemas = loadersRegistry.map((l) => l.configSchema) as [z.ZodObject<any>, ...z.ZodObject<any>[]]

export const sourceConfigSchema = z.discriminatedUnion('type', schemas) as unknown as z.ZodType<Source>
