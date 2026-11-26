import * as fsPromises from 'node:fs/promises'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {afterAll, afterEach, describe, expect, it, spyOn} from 'bun:test'

import {transactionIO} from '../fs/transaction'
import {ALIAS_STATUSES, convertAssistantsAlias, renameAssistantsKey} from './alias'
import {getProjectConfigPath, loadProjectConfig} from './loader'
import {writeProjectConfig} from './writer'

const getDir = useTmpDir('config_alias')

const V07_CONFIG = [
  '# team config, keep this comment — café',
  'version: "1"',
  'assistants: # enabled harnesses',
  '  - id: cursor',
  '    enabled: true   # inline comment',
  '',
  '# sources below',
  'sources: []',
  '',
].join('\r\n')
const RENAMED = V07_CONFIG.replace('assistants: #', 'harnesses: #')
const QUOTED = '# keep\nversion: "1"\n"assistants":\n  - id: cursor\n    enabled: true\nsources: []\n'

const rename = (text: string | Buffer) => {
  const {bytes, status} = renameAssistantsKey(Buffer.from(text))
  return {text: bytes.toString('utf-8'), status}
}

async function writeRaw(dir: string, content: string | Buffer): Promise<string> {
  const path = getProjectConfigPath(dir)
  await mkdir(join(dir, '.crucible'), {recursive: true})
  await writeFile(path, content)
  return path
}

describe('renameAssistantsKey', () => {
  it('changes only the canonical key, comments, line endings and multibyte text included', () => {
    expect(rename(V07_CONFIG)).toEqual({text: RENAMED, status: ALIAS_STATUSES.CONVERTED})
  })

  it('converts an inline empty list', () => {
    expect(rename('version: "1"\nassistants: []\n').text).toBe('version: "1"\nharnesses: []\n')
  })

  it.each([
    ['quoted', QUOTED],
    ['spaced', 'version: "1"\nassistants :\n  - id: cursor\n    enabled: true\n'],
    [
      'flow-mapping',
      '{version: "1", project: {name: "example\nassistants: literal text\nend"}, "assistants": [], sources: []}\n',
    ],
  ])('leaves a %s key untouched and reports it as non-canonical', (_, raw) => {
    expect(rename(raw)).toEqual({text: raw, status: ALIAS_STATUSES.NON_CANONICAL})
  })

  it('leaves a file that is not valid UTF-8 untouched', () => {
    const raw = Buffer.concat([Buffer.from('# caf'), Buffer.from([0xe9]), Buffer.from('\nassistants: []\n')])
    const {bytes, status} = renameAssistantsKey(raw)
    expect(status).toBe(ALIAS_STATUSES.NON_CANONICAL)
    expect(bytes.equals(raw)).toBe(true)
  })

  it.each([
    ['a commented key line', 'version: "1"\n# assistants:\nharnesses: []\n'],
    ['a harnesses-only config', 'version: "1"\nharnesses: []\n'],
    ['a key inside a block scalar', 'version: "1"\nproject:\n  description: |\n    assistants: x\nharnesses: []\n'],
  ])('does nothing for %s', (_, raw) => {
    expect(rename(raw)).toEqual({text: raw, status: ALIAS_STATUSES.NONE})
  })
})

describe('convertAssistantsAlias', () => {
  it('writes the renamed bytes and can undo them', async () => {
    const dir = getDir()
    const path = await writeRaw(dir, V07_CONFIG)
    const conversion = await convertAssistantsAlias(dir)
    expect(conversion?.status).toBe(ALIAS_STATUSES.CONVERTED)
    expect(await readFile(path, 'utf-8')).toBe(RENAMED)
    await conversion!.undo!()
    expect(await readFile(path, 'utf-8')).toBe(V07_CONFIG)
  })

  it('returns null when the file is absent', async () => {
    expect(await convertAssistantsAlias(getDir())).toBeNull()
  })
})

describe('writeProjectConfig with the assistants alias', () => {
  const events: string[] = []
  const replace = transactionIO.replace
  const replaces = spyOn(transactionIO, 'replace').mockImplementation(async (temp, path, existed) => {
    events.push(`atomic:${await readFile(temp, 'utf-8')}`)
    return replace(temp, path, existed)
  })
  const writes = spyOn(fsPromises, 'writeFile')
  const record = async (run: () => Promise<unknown>) => {
    events.length = 0
    writes.mockClear()
    await run()
    return [...events, ...writes.mock.calls.map(([, data]) => `serialized:${String(data)}`)]
  }
  afterEach(() => {
    events.length = 0
  })
  afterAll(() => {
    replaces.mockRestore()
    writes.mockRestore()
  })

  it('lands a rename-only operation as one surgical write', async () => {
    const dir = getDir()
    const path = await writeRaw(dir, V07_CONFIG)
    const loaded = (await loadProjectConfig(dir))!
    expect(await record(() => writeProjectConfig(dir, loaded))).toEqual([`atomic:${RENAMED}`])
    expect(await readFile(path, 'utf-8')).toBe(RENAMED)
  })

  it('writes the rename first, then other changes through the reserializing writer', async () => {
    const dir = getDir()
    const path = await writeRaw(dir, V07_CONFIG)
    const loaded = (await loadProjectConfig(dir))!
    const seen = await record(() => writeProjectConfig(dir, {...loaded, project: {name: 'renamed'}}))
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(`atomic:${RENAMED}`)
    expect(seen[1]).toStartWith('serialized:')
    const final = await readFile(path, 'utf-8')
    expect(`serialized:${final}`).toBe(seen[1])
    expect(final).toContain('name: renamed')
    expect(final).toContain('harnesses:')
    expect(final).not.toContain('assistants')
  })

  it('leaves a non-canonical alias untouched when nothing else changes', async () => {
    const dir = getDir()
    const path = await writeRaw(dir, QUOTED)
    const loaded = (await loadProjectConfig(dir))!
    expect(await record(() => writeProjectConfig(dir, loaded))).toEqual([])
    expect(await readFile(path, 'utf-8')).toBe(QUOTED)
  })

  it('applies other changes to a non-canonical alias config with the reserializing writer', async () => {
    const dir = getDir()
    const path = await writeRaw(dir, QUOTED)
    const loaded = (await loadProjectConfig(dir))!
    const seen = await record(() => writeProjectConfig(dir, {...loaded, project: {name: 'renamed'}}))
    expect(seen).toHaveLength(1)
    expect(await readFile(path, 'utf-8')).toContain('harnesses:')
  })
})
