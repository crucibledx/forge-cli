import {expect, it, spyOn} from 'bun:test'

import {allowlistedEnvironment, createTestSandbox} from './test-sandbox'

it('AC-19 excludes inherited secrets from the earliest compiler environment', () => {
  const previous = process.env.FORGE_COMPILER_SECRET
  process.env.FORGE_COMPILER_SECRET = 'compiler-sentinel'
  try {
    expect(allowlistedEnvironment()).not.toHaveProperty('FORGE_COMPILER_SECRET')
  } finally {
    if (previous === undefined) delete process.env.FORGE_COMPILER_SECRET
    else process.env.FORGE_COMPILER_SECRET = previous
  }
})
it('AC-19 native Windows compiles its fake scheduler only after HOME/temp/environment isolation', () => {
  if (process.platform !== 'win32') return
  const previous = process.env.FORGE_COMPILER_SECRET
  process.env.FORGE_COMPILER_SECRET = 'compiler-sentinel'
  const launches = spyOn(Bun, 'spawnSync')
  let sandbox: ReturnType<typeof createTestSandbox> | undefined
  try {
    sandbox = createTestSandbox('compiler-environment-')
    const call = launches.mock.calls.find(([args]) => Array.isArray(args) && args[1] === 'build')!
    const options = call[1] as {cwd: string; env: Record<string, string>}
    expect(options.cwd).toBe(sandbox.project)
    expect(options.env.HOME).toBe(sandbox.home)
    expect(options.env.USERPROFILE).toBe(sandbox.home)
    expect(options.env.TMPDIR).toBe(sandbox.temp)
    expect(options.env).not.toHaveProperty('FORGE_COMPILER_SECRET')
    expect(options.env).not.toHaveProperty('SSH_AUTH_SOCK')
    expect(options.env).not.toHaveProperty('BUN_OPTIONS')
  } finally {
    launches.mockRestore()
    sandbox?.dispose()
    if (previous === undefined) delete process.env.FORGE_COMPILER_SECRET
    else process.env.FORGE_COMPILER_SECRET = previous
  }
})
