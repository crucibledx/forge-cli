import {z} from 'zod'

import {gitSourceSchema} from './git'
import {localSourceSchema} from './local'

export const sourceConfigSchema = z.discriminatedUnion('type', [gitSourceSchema, localSourceSchema])
