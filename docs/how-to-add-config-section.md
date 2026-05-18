# How to Add a Config Section

Each config section is a self-contained module in `src/application/commands/config/sections/`.
Sections appear as options in the `forge config` interactive menu.

## Steps

1. **Create the section file** — `sections/<name>.ts`
    - Define a `ConfigSectionEntry` with `id`, `label`, `hint`, and `edit`
    - Import `sectionsRegistry` from `./registry` and push the section

2. **Register the import** — `sections/index.ts`
    - Add `import './<name>'` (side effect import triggers self-registration)

3. **Add tests** — `sections/<name>.test.ts`

## `ConfigSectionEntry` fields

- **`id`** — unique string identifier for the section
- **`label`** — shown in the config menu select prompt
- **`hint(config)`** — returns a summary string shown next to the label (e.g. `'3 enabled'`)
- **`edit(config, projectRoot)`** — async function that receives the current config, runs interactive prompts, and returns the updated config

## File structure reference

```
application/commands/config/sections/
    registry.ts         — mutable sectionsRegistry array
    types.ts            — ConfigSectionEntry interface
    index.ts            — side effect imports + barrel
    <name>.ts           — section definition + self-registration
    <name>.test.ts      — tests
```

## Example: `my-section.ts`

```ts
import * as prompts from '@infrastructure/cli/prompts'

import {sectionsRegistry} from './registry'
import type {ConfigSectionEntry} from './types'

export const mySection: ConfigSectionEntry = {
    id: 'my-section',
    label: 'My Section',

    hint: (config) => {
        return 'some summary'
    },

    edit: async (config, projectRoot) => {
        const value = await prompts.text({message: 'Enter value:'})
        return {...config, myField: value}
    },
}

sectionsRegistry.push(mySection)
```
