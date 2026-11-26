import {promptHarnessSelection, runHarnessScan} from '@application/commands/shared/harness.prompt'
import * as renderer from '@infrastructure/cli/renderer'

import {sectionsRegistry} from './registry'
import type {ConfigSectionEntry} from './types'

export {HARNESS_PROMPT_MESSAGES as HARNESSES_MESSAGES} from '@application/commands/shared/harness.prompt'

export const harnessesSection: ConfigSectionEntry = {
  id: 'harnesses',
  label: 'Harnesses',

  hint: (config) => {
    const enabled = config.harnesses.filter((a) => a.enabled)
    return enabled.length > 0 ? `${enabled.length} enabled` : 'none enabled'
  },

  edit: async (config, projectRoot) => {
    const scan = runHarnessScan(projectRoot)
    renderer.renderNewline()

    const enabledIds = config.harnesses.filter((a) => a.enabled).map((a) => a.id)

    const harnesses = await promptHarnessSelection(scan, enabledIds)
    return {...config, harnesses}
  },
}

sectionsRegistry.push(harnessesSection)
