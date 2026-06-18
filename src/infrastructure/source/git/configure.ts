import * as prompts from '@infrastructure/cli/prompts'

import {DEFAULT_SOURCE_NAME} from '../constants'
import type {SourceLoaderEntry} from '../types'
import {GitError, runGit} from './load'
import {GIT_SOURCE_MESSAGES} from './messages'
import {gitSourceSchema} from './schema.types'
import type {GitSourceConfig} from './types'

export {gitSourceSchema}

export const configure: SourceLoaderEntry['configure'] = async (existing) => {
  const prev = existing as Partial<GitSourceConfig> | undefined
  const url = await prompts.text({
    message: GIT_SOURCE_MESSAGES.url.message,
    placeholder: prev?.url ?? GIT_SOURCE_MESSAGES.url.placeholder,
    defaultValue: prev?.url,
    validate: (val) => {
      if (!val?.trim()) return GIT_SOURCE_MESSAGES.url.required
      return undefined
    },
  })
  const branch = await prompts.text({
    message: GIT_SOURCE_MESSAGES.branch,
    placeholder: prev?.branch ?? 'main',
    defaultValue: prev?.branch ?? 'main',
  })
  const path = await prompts.text({
    message: GIT_SOURCE_MESSAGES.subdirectory.message,
    placeholder: prev?.path ?? GIT_SOURCE_MESSAGES.subdirectory.placeholder,
    defaultValue: prev?.path,
  })

  const source: GitSourceConfig = {
    name: DEFAULT_SOURCE_NAME,
    type: 'git',
    url: url.trim(),
    branch: branch?.trim() || 'main',
    path: path?.trim() || undefined,
  }

  const s = prompts.spinner()
  s.start(GIT_SOURCE_MESSAGES.verify.checking)
  const verification = await verifyGitSource(source.url, source.branch)
  if (verification.success) {
    s.stop(GIT_SOURCE_MESSAGES.verify.success)
  } else {
    s.stop(GIT_SOURCE_MESSAGES.verify.failed)
    prompts.log.warn(GIT_SOURCE_MESSAGES.verify.unreachable(verification.error ?? 'unknown error'))
  }

  return source
}

export async function verifyGitSource(url: string, branch: string): Promise<{success: boolean; error?: string}> {
  try {
    await runGit(undefined, ['ls-remote', '--exit-code', url, `refs/heads/${branch}`], {
      timeoutMs: 10_000,
      env: {GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=5'},
    })
    return {success: true}
  } catch (err) {
    return {
      success: false,
      error: err instanceof GitError ? err.message : String(err),
    }
  }
}
