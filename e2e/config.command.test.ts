/**
 * E2E tests for `forge config`.
 *
 * Strategy: spawn the CLI in a real PTY so that @clack/prompts enters raw mode.
 * Use waitForText() before each input — fully deterministic, no fixed sleeps.
 */

import {describe, expect, it} from 'bun:test'

import {CONFIG_MESSAGES as M} from '@application/commands/config/messages'

import {
    type CLIResult,
    type CLISession,
    configFilePath,
    spawnCommand,
    TIMEOUT_MS,
    useTmpDir,
} from './helpers'

// ─── Temp directory ───────────────────────────────────────────────────────────

const getDir = useTmpDir('forge-config-e2e')

// ─── Convenience ──────────────────────────────────────────────────────────────

async function runConfigSession(
    cwd: string,
    drive: (cli: CLISession) => Promise<void>,
): Promise<CLIResult> {
    const cli = spawnCommand(cwd, 'config')
    const done = cli.waitForExit()
    await drive(cli)
    return done
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('forge config — e2e', () => {
    it('shows no-config warning when no config file exists', async () => {
        const {output} = await runConfigSession(getDir(), (cli) =>
            cli.waitForText(M.noConfig),
        )
        expect(output).toContain(M.noConfig)
    }, TIMEOUT_MS)

    it('shows no-sections warning when config exists but no sections registered', async () => {
        // Write a minimal config so the no-config guard passes
        const configPath = configFilePath(getDir())
        await Bun.write(configPath, 'version: "1"\nassistants: []\nsources: []\n')

        const {output} = await runConfigSession(getDir(), (cli) =>
            cli.waitForText(M.noSections),
        )
        expect(output).toContain(M.noSections)
    }, TIMEOUT_MS)
})
