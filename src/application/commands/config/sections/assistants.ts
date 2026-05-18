import {promptAssistantSelection, runAssistantScan} from '@application/commands/shared/assistant.prompt'
import * as renderer from '@infrastructure/cli/renderer'

import type {ConfigSectionEntry} from './types'

export {ASSISTANT_PROMPT_MESSAGES as ASSISTANTS_MESSAGES} from '@application/commands/shared/assistant.prompt'

export const assistantsSection: ConfigSectionEntry = {
  id: 'assistants',
  label: 'Assistants',

  hint: (config) => {
    const enabled = config.assistants.filter((a) => a.enabled)
    return enabled.length > 0 ? `${enabled.length} enabled` : 'none enabled'
  },

  edit: async (config, projectRoot) => {
    const scan = runAssistantScan(projectRoot)
    renderer.renderNewline()

    const enabledIds = config.assistants.filter((a) => a.enabled).map((a) => a.id)

    const assistants = await promptAssistantSelection(scan, enabledIds)
    return {...config, assistants}
  },
}
