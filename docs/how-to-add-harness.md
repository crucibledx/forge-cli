# How to Add a New Harness

Each harness is a self-contained module in `src/domain/harnesses/<name>/`.

## Steps

1. **Create the directory** — `src/domain/harnesses/<name>/`

2. **Define the harness** — `index.ts`
    - Export an `HarnessDefinition` object with `id`, `name`, `detection`, and `targetMappings`
    - Import `harnessesRegistry` from `../registry` and push the definition

3. **Register the import** — `src/domain/harnesses/index.ts`
    - Add `import './<name>'` (side effect import triggers self-registration)

4. **Add tests** — verify detection rules and target mappings via the registry

## `HarnessDefinition` fields

- **`id`** — unique string identifier (used in config YAML)
- **`name`** — human-readable label (shown in CLI prompts)
- **`detection.directories`** — dirs whose presence signals the harness is in use (prefix `~/` for global)
- **`detection.files`** — files whose presence signals the harness is in use
- **`targetMappings`** — array of `{ sourceGlob, destination, transforms? }`
    - `sourceGlob` — glob matching files from the source
    - `destination` — `{ project: string, global?: string }` target directories for matched files
    - `transforms` — optional array of `{ transformer, params }` steps (see `docs/how-to-add-transformer.md`)

## File structure reference

```
domain/harnesses/<name>/
  index.ts   — HarnessDefinition + self-registration
```

## Example: `index.ts`

```ts
import {harnessesRegistry} from '../registry'
import type {HarnessDefinition} from '../types'

export const myHarness: HarnessDefinition = {
    id: 'my-harness',
    name: 'My Harness',
    detection: {
        directories: ['.my-harness', '~/.my-harness'],
        files: ['.my-harness/config.json'],
    },
    targetMappings: [
        {sourceGlob: 'rules/**', destination: {project: '.my-harness/rules/', global: '~/.my-harness/rules/'}},
        {sourceGlob: 'skills/**', destination: {project: '.my-harness/skills/'}},
    ],
}

harnessesRegistry.push(myHarness)
```
