# How to Add a New Transformer

Each transformer is a self-contained module in `src/domain/transforms/<name>/`.

## Steps

1. **Create the directory** — `src/domain/transforms/<name>/`
2. **Define the transformer** — `index.ts`
    - Export a `TransformerEntry` with `id` and `apply`
    - Import `transformersRegistry` from `../registry` and push the entry
3. **Register the import** — `src/domain/transforms/index.ts`
    - Add `import './<name>'` (side effect import triggers self-registration)
4. **Add tests** — `index.test.ts`

## `TransformerEntry` fields

- **`id`** — unique string identifier referenced in `TargetMapping.transforms[].transformer`
- **`apply(context, params)`** — pure function that receives a `TransformContext { filename, content }` and a `Record<string, string>` params object, returns the (possibly modified) context

## `TransformContext`

Every transformer receives and returns a `TransformContext`:

```ts
{
    filename: string
    content: string
}
```

The transformer modifies whichever fields it needs and passes the rest through.
Future context fields (e.g. `metadata`, `skip`) can be added without breaking existing transformers.

## `TransformStep` (used in assistant `targetMappings`)

```json5
{
  transformer: 'my-transformer',
  params: {
    key: 'value'
  }
}
```

## File structure reference

```
domain/transforms/<name>/
    index.ts        — TransformerEntry + self-registration
    index.test.ts   — tests
```

## Built-in transformers

- **`rename`** — modifies `filename`, params: `{ from, to }` — replaces file extension suffix
- **`frontmatter-rename`** — modifies `content`, params: `{ from, to }` — renames a YAML frontmatter key

## Example: `index.ts`

```ts
import {transformersRegistry} from '../registry'
import type {TransformerEntry} from '../types'

export const myTransformer: TransformerEntry = {
    id: 'my-transformer',
    apply: (context, params) => {
        const {from, to} = params
        if (!from || !to) return context
        return {...context, content: context.content.replaceAll(from, to)}
    },
}

transformersRegistry.push(myTransformer)
```
