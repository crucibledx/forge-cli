import {relative} from 'node:path'

import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {loadProjectConfig, writeProjectConfig} from '@infrastructure/config'
import io from '@infrastructure/io'

import {CONFIG_MESSAGES as M} from './messages'
import {sections} from './sections'
import type {ConfigCommandAction} from './types'

export const runConfig: ConfigCommandAction = async () => {
    const projectRoot = io.resolveProjectRoot()

    prompts.intro(M.intro)

    const loaded = await loadProjectConfig(projectRoot)

    if (!loaded) {
        renderer.renderWarning(M.noConfig)
        prompts.outro(M.outroCancelled)
        return
    }

    if (sections.length === 0) {
        renderer.renderWarning(M.noSections)
        prompts.outro(M.outroCancelled)
        return
    }

    let config = loaded
    let changed = false
    let editing = true

    while (editing) {
        const sectionId = await prompts.select({
            message: M.selectSection,
            options: sections.map((s) => ({
                value: s.id,
                label: s.label,
                hint: s.hint(config),
            })),
        })

        const section = sections.find((s) => s.id === sectionId)!
        config = await section.edit(config, projectRoot)
        changed = true

        if (sections.length > 1) {
            editing = await prompts.confirm({
                message: M.changeAnother,
                initialValue: false,
            })
        } else {
            editing = false
        }
    }

    if (changed) {
        const configPath = await writeProjectConfig(projectRoot, config)
        renderer.renderNewline()
        renderer.renderSuccess(M.outro)
        renderer.renderDim(relative(projectRoot, configPath))
    } else {
        prompts.outro(M.outroCancelled)
    }
}
