import {assistantsSection} from './assistants'
import {sourceSection} from './source'
import type {ConfigSectionEntry} from './types'

export type {ConfigSectionEntry} from './types'

export const sections: ConfigSectionEntry[] = [
    assistantsSection,
    sourceSection,
]
