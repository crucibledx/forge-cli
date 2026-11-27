import {expect, it} from 'bun:test'

import {claudeMadeNoModelCall} from './harness-cli'

const synthetic = {type: 'assistant', message: {model: '<synthetic>'}}
const result = {type: 'result', total_cost_usd: 0, duration_api_ms: 0, modelUsage: {}}

it.each([
  ['a synthetic "Not logged in" run', [synthetic, result], true],
  ['a run that cost money', [synthetic, {...result, total_cost_usd: 0.01}], false],
  ['a run that spent API time', [synthetic, {...result, duration_api_ms: 120}], false],
  ['a run with model usage', [synthetic, {...result, modelUsage: {'claude-x': {inputTokens: 1}}}], false],
  ['a run answered by a real model', [{type: 'assistant', message: {model: 'claude-x'}}, result], false],
  ['a run with no result event', [synthetic], false],
])('0004-AC-2 the no-model guard judges %s', (_, events, ok) => {
  expect(claudeMadeNoModelCall(events).ok).toBe(ok)
})
