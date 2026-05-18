# How to Add a New Command

Each command is a self-contained module in `src/application/commands/<name>/`.

## Steps

1. **Create the directory** — `src/application/commands/<name>/`

2. **Define types** — `types.ts`
    - Extend `CommandDefinition` with a typed options interface if needed

3. **Implement handler** — `handler.ts`
    - Export an async function that receives parsed options
    - Resolve `projectRoot` via `io.resolveProjectRoot()`
    - Use `@infrastructure/*` barrels for all I/O

4. **Assemble and register** — `index.ts`
    - Build `CommandDefinition` with `name`, `description`, `options`, `action`
    - Import `commandsRegistry` from `../registry` and push the command

5. **Register the import** — `src/application/commands/index.ts`
    - Add `import './<name>'` (side effect import triggers self-registration)

6. **Add tests** — `handler.test.ts`

## `CommandDefinition` fields

- **`name`** — CLI subcommand name (e.g. `'init'`, `'sync'`)
- **`description`** — shown in `--help` output
- **`options`** — array of `{ flags, description, defaultValue? }`
    - `flags` — Commander.js flag syntax (e.g. `'-v, --verbose'`, `'--dry-run'`)
- **`action`** — async handler function receiving parsed options

## File structure reference

```
application/commands/<name>/
  types.ts       — command-specific option types
  handler.ts     — command logic
  index.ts       — CommandDefinition + self-registration
  handler.test.ts
```

## Example: `index.ts`

```ts
import {commandsRegistry} from '../registry'
import {runMyCommand} from './handler'
import type {MyCommandDefinition} from './types'

export const myCommand: MyCommandDefinition = {
    name: 'my-command',
    description: 'Does something useful',
    options: [
        {flags: '--dry-run', description: 'Preview without changes', defaultValue: false},
    ],
    action: runMyCommand,
}

commandsRegistry.push(myCommand)
```
