# How to Add a New Source Type

Each source loader is a self-contained module in `src/infrastructure/source/<type>/`.

## Steps

1. **Create the directory** — `src/infrastructure/source/<type>/`

2. **Define types** — `types.ts`
    - Interface extending `Source` from `@domain/config/types`
    - Must include `type: '<type>'` literal

3. **Define schema** — `schema.types.ts`
    - Zod schema with `type: z.literal('<type>')` for discriminated union

4. **Add messages** — `messages.ts`
    - Prompt message constants used by `configure.ts`

5. **Implement configure** — `configure.ts`
    - `export const configure: SourceLoaderEntry['configure']` — interactive wizard
    - Returns a configured `Source` object

6. **Implement load** — `load.ts`
    - `export const load: SourceLoaderEntry['load']` — fetches/resolves the source
    - Returns `{ localPath, fresh }`

7. **Assemble and register** — `index.ts`
    - Build `SourceLoaderEntry` object with `alias`, `label`, `configSchema`, `configure`, `load`
    - Import `loadersRegistry` from `../registry` and push the loader
    - Re-export public symbols

8. **Add schema to union** — `source/schema.ts`
    - Import your schema, add it to the `z.discriminatedUnion('type', [...])` array

9. **Re-export from barrel** — `source/index.ts`
    - Export your public types/values

10. **Add tests** — `configure.test.ts` + `load.test.ts`

## File structure reference

```
source/<type>/
  types.ts           — TypeSourceConfig interface
  schema.types.ts    — Zod schema (typeSourceSchema)
  messages.ts        — prompt message constants
  configure.ts       — configure() + validation helpers
  load.ts            — load() + error class + helpers
  index.ts           — assembles SourceLoaderEntry, self-registers
  configure.test.ts  — tests for configure
  load.test.ts       — tests for load
```

## Example: `index.ts`

```ts
import type {SourceLoaderEntry} from '../types'
import {loadersRegistry} from '../registry'
import {configure} from './configure'
import {load} from './load'
import {mySourceSchema} from './schema.types'

export const myLoader: SourceLoaderEntry = {
    alias: 'my-type',
    label: 'My Source Type',
    configSchema: mySourceSchema,
    configure,
    load,
}

loadersRegistry.push(myLoader)
```
