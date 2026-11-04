import {readdir, unlink} from 'node:fs/promises'
import {resolve} from 'node:path'

// Same generated-file scope as the former POSIX find command, on every OS.
const root = resolve(import.meta.dir, '..')
for (const entry of await readdir(root, {withFileTypes: true})) {
  if (entry.isFile() && entry.name.endsWith('.bun-build')) await unlink(resolve(root, entry.name))
}
