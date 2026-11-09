import {describe, expect, it, spyOn} from 'bun:test'

import type {DetectionResult} from '@domain/assistants'
import type {OutputEntry} from '@domain/protocol/types'

import * as renderer from './renderer'

it('AC-15,30 every renderer redacts credentials before escaping without swallowing later public diagnostics', () => {
  const logs: string[] = []
  const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))
  const text = 'Authorization: Basic PRIVATE_CREDENTIAL_Q\nPUBLIC_AFTER_DIAGNOSTIC'
  try {
    renderer.setSilent(false)
    renderer.renderHeader(text)
    renderer.renderDetectionResults([{id: 'cursor', name: text, detected: true, evidence: text}])
    renderer.renderSyncFile(text, 'new', false)
    renderer.renderDriftFile(text, 'modified')
    renderer.renderSuccess(text)
    renderer.renderInfo(text)
    renderer.renderWarning(text)
    renderer.renderError(text, text)
    renderer.renderDim(text)
    renderer.render(text)
    renderer.renderOutputEntries([{level: 'warn', message: text, detail: text}])
  } finally {
    spy.mockRestore()
  }
  for (const line of logs.filter((line) => line.includes('Authorization'))) {
    expect(line).not.toContain('PRIVATE_CREDENTIAL_Q')
    expect(line).toContain('PUBLIC_AFTER_DIAGNOSTIC')
  }
  expect(logs.filter((line) => line.includes('Authorization')).length).toBeGreaterThan(10)
})

it('AC-15,30 renderer fields escape untrusted terminal controls before adding trusted presentation', () => {
  const logs: string[] = []
  const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))
  const text = 'visible/é\x1b]52;c;fixture\x07\x1b[2J.md'
  try {
    renderer.setSilent(false)
    renderer.renderHeader(text)
    renderer.renderDetectionResults([{id: 'cursor', name: text, detected: true, evidence: text}])
    renderer.renderSyncFile(text, 'new', false)
    renderer.renderDriftFile(text, 'modified')
    renderer.renderSuccess(text)
    renderer.renderInfo(text)
    renderer.renderWarning(text)
    renderer.renderError(text, text)
    renderer.renderDim(text)
    renderer.render(text)
    renderer.renderOutputEntries([{level: 'warn', message: text, detail: text}])
  } finally {
    spy.mockRestore()
  }
  const output = logs.join('\n')
  expect(output).not.toContain('\x1b]52')
  expect(output).not.toContain('\x07')
  expect(output).not.toContain('\x1b[2J')
  expect(output).toContain('visible/é\\u001b]52;c;fixture\\u0007\\u001b[2J.md')
})

describe('renderHeader', () => {
  it('calls console.log with box-drawing border containing the title', () => {
    const logs: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))

    renderer.renderHeader('Test Title')

    spy.mockRestore()
    const output = logs.join('\n')
    expect(output).toContain('Test Title')
    expect(output).toContain('┌')
    expect(output).toContain('┘')
  })
})

describe('renderDetectionResults', () => {
  it('prints detected assistant with checkmark', () => {
    const logs: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(String(args[0])))

    const results: DetectionResult[] = [
      {id: 'cursor', name: 'Cursor', detected: true, evidence: '.cursor/ found (2 items)'},
    ]
    renderer.renderDetectionResults(results)
    spy.mockRestore()

    expect(logs[0]).toContain('Cursor')
  })

  it('prints undetected assistant with dim marker', () => {
    const logs: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(String(args[0])))

    const results: DetectionResult[] = [{id: 'cline', name: 'Cline', detected: false}]
    renderer.renderDetectionResults(results)
    spy.mockRestore()

    expect(logs[0]).toContain('Cline')
  })
})

describe('renderSyncFile', () => {
  it('renders new file status', () => {
    const logs: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(String(args[0])))

    renderer.renderSyncFile('skills/ts.md', 'new', false)
    spy.mockRestore()

    expect(logs[0]).toContain('skills/ts.md')
    expect(logs[0]).toContain('new')
  })

  it('renders update file status', () => {
    const logs: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(String(args[0])))

    renderer.renderSyncFile('skills/ts.md', 'update', false)
    spy.mockRestore()

    expect(logs[0]).toContain('update')
  })

  it('renders no_change file status', () => {
    const logs: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(String(args[0])))

    renderer.renderSyncFile('skills/ts.md', 'no_change', false)
    spy.mockRestore()

    expect(logs[0]).toContain('no change')
  })

  it('uses + prefix in dry-run for new files', () => {
    const logs: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(String(args[0])))

    renderer.renderSyncFile('file.md', 'new', true)
    spy.mockRestore()

    expect(logs[0]).toContain('+')
  })
})

describe('renderOutputEntries', () => {
  it('dispatches each entry to the correct renderer', () => {
    const logs: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(String(args[0])))

    const entries: OutputEntry[] = [
      {level: 'success', message: 'done'},
      {level: 'info', message: 'note'},
      {level: 'warn', message: 'careful'},
      {level: 'error', message: 'bad'},
      {level: 'debug', message: 'verbose'},
    ]
    renderer.renderOutputEntries(entries)
    spy.mockRestore()

    const combined = logs.join('\n')
    expect(combined).toContain('done')
    expect(combined).toContain('note')
    expect(combined).toContain('careful')
    expect(combined).toContain('bad')
    expect(combined).toContain('verbose')
  })

  it('renders entry detail as dimmed line', () => {
    const logs: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(String(args[0])))

    renderer.renderOutputEntries([{level: 'info', message: 'msg', detail: 'some detail'}])
    spy.mockRestore()

    expect(logs.join('\n')).toContain('some detail')
  })
})

describe('renderError', () => {
  it('renders message', () => {
    const logs: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(String(args[0])))

    renderer.renderError('Something failed')
    spy.mockRestore()

    expect(logs[0]).toContain('Something failed')
  })

  it('renders optional suggestion on second line', () => {
    const logs: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((...args) => logs.push(String(args[0])))

    renderer.renderError('Fail', 'Try again')
    spy.mockRestore()

    expect(logs.join('\n')).toContain('Try again')
  })
})
