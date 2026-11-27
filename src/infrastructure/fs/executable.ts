import {constants} from 'node:fs'
import {access} from 'node:fs/promises'
import {delimiter, join} from 'node:path'

/**
 * True when `name` resolves to an executable on PATH (PATHEXT-aware on Windows). Sync uses it for prerequisites
 * of the files it delivers, such as the interpreter a generated Droid hook spawns.
 */
export async function executableOnPath(name: string): Promise<boolean> {
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean))
    for (const extension of extensions)
      if (
        await access(join(dir, name + extension), constants.X_OK).then(
          () => true,
          () => false,
        )
      )
        return true
  return false
}
