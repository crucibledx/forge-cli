import * as fsPromises from 'node:fs/promises'
import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {afterAll, describe, expect, it, spyOn} from 'bun:test'

import {ALIAS_STATUSES, convertAssistantsAlias, renameAssistantsKey} from './alias'
import {getProjectConfigPath, loadProjectConfig} from './loader'
import {writeProjectConfig} from './writer'

const getDir = useTmpDir('config_alias')

const V07_CONFIG = [
  '# team config, keep this comment',
  'version: "1"',
  'assistants: # enabled harnesses',
  '  - id: cursor',
  '    enabled: true   # inline comment',
  '',
  '# sources below',
  'sources: []',
  '',
].join('\r\n')

async function writeRaw(dir: string, content: string | Buffer): Promise<string> {
  const path = getProjectConfigPath(dir)
  await fsPromises.mkdir(join(dir, '.crucible'), {recursive: true})
  await writeFile(path, content)
  return path
}

describe('renameAssistantsKey', () => {
  it('changes only the canonical key line, comments and line endings included', () => {
    const {text, status} = renameAssistantsKey(V07_CONFIG)
    expect(status).toBe(ALIAS_STATUSES.CONVERTED)
    expect(text).toBe(V07_CONFIG.replace('assistants: # enabled', 'harnesses: # enabled'))
  })

  it('converts an inline empty list', () => {
    expect(renameAssistantsKey('version: "1"\nassistants: []\n').text).toBe('version: "1"\nharnesses: []\n')
  })

  it.each([
    ['quoted', 'version: "1"\n"assistants":\n  - id: cursor\n    enabled: true\n'],
    ['spaced', 'version: "1"\nassistants :\n  - id: cursor\n    enabled: true\n'],
  ])('leaves a %s key untouched and reports it as non-canonical', (_, raw) => {
    expect(renameAssistantsKey(raw)).toEqual({text: raw, status: ALIAS_STATUSES.NON_CANONICAL})
  })

  it('leaves a commented key line untouched', () => {
    const raw = 'version: "1"\n# assistants:\nharnesses: []\n'
    expect(renameAssistantsKey(raw)).toEqual({text: raw, status: ALIAS_STATUSES.NONE})
  })

  it('does nothing for a config that already uses harnesses', () => {
    const raw = 'version: "1"\nharnesses: []\n'
    expect(renameAssistantsKey(raw)).toEqual({text: raw, status: ALIAS_STATUSES.NONE})
  })
})

describe('convertAssistantsAlias', () => {
  it('is byte-identical apart from the key line, including non-UTF-8 bytes in comments', async () => {
    const original = Buffer.concat([Buffer.from('# caf'), Buffer.from([0xe9]), Buffer.from('\n' + V07_CONFIG)])
    const path = await writeRaw(getDir(), original)
    await convertAssistantsAlias(path)
    const expected = Buffer.from(original.toString('latin1').replace('assistants: #', 'harnesses: #'), 'latin1')
    expect((await readFile(path)).equals(expected)).toBe(true)
  })

  it('returns null and writes nothing when the file is absent', async () => {
    expect(await convertAssistantsAlias(getProjectConfigPath(getDir()))).toBeNull()
  })
})

describe('writeProjectConfig with the assistants alias', () => {
  const writes = spyOn(fsPromises, 'writeFile')
  const renamed = V07_CONFIG.replace('assistants: #', 'harnesses: #')
  const written = () => writes.mock.calls.map(([, data]) => Buffer.from(data as string | Buffer).toString('utf-8'))
  afterAll(() => writes.mockRestore())

  it('lands a rename-only operation as one surgical write', async () => {
    const dir = getDir()
    const path = await writeRaw(dir, V07_CONFIG)
    const loaded = (await loadProjectConfig(dir))!
    writes.mockClear()
    await writeProjectConfig(dir, loaded)
    expect(written()).toEqual([renamed])
    expect(await readFile(path, 'utf-8')).toBe(renamed)
  })

  it('writes the rename first, then other changes through the reserializing writer', async () => {
    const dir = getDir()
    const path = await writeRaw(dir, V07_CONFIG)
    const loaded = (await loadProjectConfig(dir))!
    writes.mockClear()
    await writeProjectConfig(dir, {...loaded, project: {name: 'renamed'}})
    const [first, second] = written()
    expect(written()).toHaveLength(2)
    expect(first).toBe(renamed)
    expect(second).toContain('name: renamed')
    const final = await readFile(path, 'utf-8')
    expect(final).toBe(second)
    expect(final).toContain('harnesses:')
    expect(final).not.toContain('assistants')
  })
})
