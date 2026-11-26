# How to Add a New Harness

Each coding harness is a self-contained module in `src/domain/harnesses/<name>/`: one folder plus one import, with no
changes to commands or handlers.

## Steps

1. **Create the directory**: `src/domain/harnesses/<name>/`
2. **Define the harness** in `index.ts`: export a `HarnessDefinition` and push it onto `harnessesRegistry`.
3. **Register the import** in `src/domain/harnesses/index.ts`: add `import './<name>'` (the side-effect import
   triggers self-registration). The config schema accepts the new `id` from the registry.
4. **Add tests**: the registry tests check every built-in automatically (see
   [Consistency test](#consistency-test)); add detection and sync tests for anything specific to the harness.

Paths follow the vendor's own documentation. Forge doesn't invent folder conventions.

## `HarnessDefinition` fields

- **`id`**: unique identifier, used in the `harnesses:` list of the config.
- **`name`**: human-readable label shown in prompts and output.
- **`detection.directories`**: folders whose presence (with at least one file) signals the harness is in use.
  Prefix `~/` for folders under the home directory.
- **`detection.files`**: files whose presence signals the harness is in use (`~/` prefix for home).
- **`targetMappings`**: the loose-resource sync, an array of `{sourceGlob, destination, transforms?}`.
  - `sourceGlob`: `skills/**`, `rules/**` or `workflows/**` in a canonical source.
  - `destination`: `{project, global?}` folders, relative to the project root and to the home directory. Without
    `global`, `--global` uses the `project` path under the home directory.
  - `transforms`: optional `{transformer, params}` steps (see `docs/how-to-add-transformer.md`).
- **`components`**: what the harness can load, and where (see [Components](#components)).
- **`plugin`**: optional plugin capability `{emit, register}`, set only when the harness's plugin emitter and
  registrar exist. Leave it unset otherwise; the harness then keeps its loose-resource sync.

## Components

`components` maps a component kind to a `ComponentTarget`. It is the source of truth for new code.

| Kind | Meaning |
|---|---|
| `skill` | Skill folders (`SKILL.md` plus files) |
| `rule` | Always-on instructions |
| `command` | Slash commands (source `workflows/`) |
| `agent` | Subagents |
| `hook` | Lifecycle hooks |
| `mcp` | MCP servers |
| `lsp` | LSP servers |
| `output-style` | Output styles |
| `setting` | Harness settings |

A missing kind means the harness has no such concept. When a canonical source has a folder the harness has no
mapping for, `forge sync` reports those files as not delivered to that harness.

`ComponentTarget` fields:

- `project`: path relative to the project root. A folder ends with `/`, a file does not.
- `global`: path relative to the home directory, written with a `~/` prefix.
- `format`: a format ID from the registry below.
- `key`: for keyed formats, the JSON key to merge under (for example `mcpServers`).
- `transforms`: the same steps as the matching target mapping.

## Format registry

`format` IDs are a closed registry in `src/domain/harnesses/formats.ts` (`COMPONENT_FORMATS`):

| ID | Format |
|---|---|
| `skill-dir` | A folder per skill |
| `markdown` | One Markdown file per resource |
| `mcp-json` | A JSON file with an `mcpServers`-style object |
| `json-keys` | Entries merged under `key` in a JSON settings file |

Add a format there before a definition uses it.

## Consistency test

`src/domain/harnesses/registry.test.ts` runs for every registered harness and checks that:

- every `targetMappings` entry has a `components` entry of the matching kind (`skills/**` → `skill`,
  `rules/**` → `rule`, `workflows/**` → `command`) with the same `project` path, the same effective global path
  (`~/` + `destination.global ?? destination.project`) and the same transforms;
- every `skill`, `rule` or `command` component has a mapping;
- every component uses a registered format, and every `global` path starts with `~/`;
- `plugin` is unset on every built-in.

Write `targetMappings` and `components` by hand, and let the test keep them aligned.

## Example: `index.ts`

```ts
import {COMPONENT_FORMATS as F} from '../formats'
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
    {sourceGlob: 'skills/**', destination: {project: '.my-harness/skills/'}},
    {sourceGlob: 'rules/**', destination: {project: '.my-harness/rules/', global: '.config/my-harness/rules/'}},
  ],
  components: {
    skill: {project: '.my-harness/skills/', global: '~/.my-harness/skills/', format: F.SKILL_DIR},
    rule: {project: '.my-harness/rules/', global: '~/.config/my-harness/rules/', format: F.MARKDOWN},
    mcp: {project: '.my-harness/mcp.json', format: F.MCP_JSON, key: 'mcpServers'},
  },
}

harnessesRegistry.push(myHarness)
```
