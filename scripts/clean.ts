import {readdir, unlink} from 'node:fs/promises'
import {resolve} from 'node:path'

import {repositoryRoot} from './validation-identity'

// Same generated-file scope as the former POSIX find command, on every OS.
for (const entry of await readdir(repositoryRoot, {withFileTypes: true})) {
  if (entry.isFile() && entry.name.endsWith('.bun-build')) await unlink(resolve(repositoryRoot, entry.name))
}
