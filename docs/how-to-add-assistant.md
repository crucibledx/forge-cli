# How to Add a New Assistant

Each assistant is a self-contained module in `src/domain/assistants/<name>/`.

## Steps

1. **Create the directory** — `src/domain/assistants/<name>/`

2. **Define the assistant** — `index.ts`
    - Export an `AssistantDefinition` object with `id`, `name`, `detection`, and `targetMappings`
    - Import `assistantsRegistry` from `../registry` and push the definition

3. **Register the import** — `src/domain/assistants/index.ts`
    - Add `import './<name>'` (side effect import triggers self-registration)

4. **Add tests** — verify detection rules and target mappings via the registry

## `AssistantDefinition` fields

- **`id`** — unique string identifier (used in config YAML)
- **`name`** — human-readable label (shown in CLI prompts)
- **`detection.directories`** — dirs whose presence signals the assistant is in use (prefix `~/` for global)
- **`detection.files`** — files whose presence signals the assistant is in use
- **`targetMappings`** — array of `{ sourceGlob, destination, transforms? }`
    - `sourceGlob` — glob matching files from the source
    - `destination` — `{ project: string, global?: string }` target directories for matched files
    - `transforms` — optional array of `{ transformer, params }` steps (see `docs/how-to-add-transformer.md`)

## File structure reference

```
domain/assistants/<name>/
  index.ts   — AssistantDefinition + self-registration
```

## Example: `index.ts`

```ts
import {assistantsRegistry} from '../registry'
import type {AssistantDefinition} from '../types'

export const myAssistant: AssistantDefinition = {
    id: 'my-assistant',
    name: 'My Assistant',
    detection: {
        directories: ['.my-assistant', '~/.my-assistant'],
        files: ['.my-assistant/config.json'],
    },
    targetMappings: [
        {sourceGlob: 'rules/**', destination: {project: '.my-assistant/rules/', global: '~/.my-assistant/rules/'}},
        {sourceGlob: 'skills/**', destination: {project: '.my-assistant/skills/'}},
    ],
}

assistantsRegistry.push(myAssistant)
```
