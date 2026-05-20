import {escapeRegExp} from 'lodash-es'

import {transformersRegistry} from '../registry'
import type {TransformerEntry} from '../types'

const NEWLINE = /[\r\n]/

export const frontmatterRenameTransformer: TransformerEntry = {
  id: 'frontmatter-rename',
  apply: (context, params) => {
    const {from, to} = params
    if (!from || !to) return context
    if (NEWLINE.test(from) || NEWLINE.test(to)) return context
    return {...context, content: renameFrontmatterKey(context.content, from, to)}
  },
}

function renameFrontmatterKey(content: string, fromKey: string, toKey: string): string {
  if (!content.startsWith('---')) return content

  const endIdx = content.indexOf('---', 3)
  if (endIdx === -1) return content

  const frontmatter = content.slice(0, endIdx + 3)
  const body = content.slice(endIdx + 3)

  const updated = frontmatter.replace(new RegExp(`^${escapeRegExp(fromKey)}:`, 'm'), `${toKey}:`)

  return updated + body
}

transformersRegistry.push(frontmatterRenameTransformer)
