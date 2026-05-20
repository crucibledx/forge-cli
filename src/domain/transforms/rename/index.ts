import {transformersRegistry} from '../registry'
import type {TransformerEntry} from '../types'

const PATH_SEP = /[/\\]/

export const renameTransformer: TransformerEntry = {
  id: 'rename',
  apply: (context, params) => {
    const {from, to} = params
    if (!from || to === undefined) return context
    if (PATH_SEP.test(from) || PATH_SEP.test(to)) return context
    if (context.filename.endsWith(from)) {
      return {...context, filename: context.filename.slice(0, -from.length) + to}
    }
    return context
  },
}

transformersRegistry.push(renameTransformer)
