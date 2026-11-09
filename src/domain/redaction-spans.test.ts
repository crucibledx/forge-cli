import {expect, it} from 'bun:test'

import {projectRedactionSpans} from './redact'

it('AC-15,16,30 shared span projection agrees with an independent per-code-unit coordinate oracle', () => {
  const segments = [
    {raw: 4, visible: 0, length: 2},
    {raw: 11, visible: 2, length: 3},
    {raw: 21, visible: 5, length: 2},
  ]
  for (const [from, to] of [
    ['raw', 'visible'],
    ['visible', 'raw'],
  ] as const)
    for (const offsets of [
      {raw: 0, visible: 0},
      {raw: 7, visible: 1},
      {raw: 20, visible: 6},
    ])
      for (let start = -3; start < 25; start++)
        for (let end = start + 1; end < 28; end++) {
          const points = segments
            .flatMap((segment) =>
              Array.from({length: segment.length}, (_, index) => ({
                source: segment[from] + index - offsets[from],
                destination: segment[to] + index - offsets[to],
              })),
            )
            .filter((point) => point.source >= start && point.source < end)
          const expected = points.length
            ? [
                {
                  start: Math.min(...points.map((p) => p.destination)),
                  end: Math.max(...points.map((p) => p.destination)) + 1,
                },
              ]
            : []
          expect(projectRedactionSpans([{start, end}], segments, from, to, offsets)).toEqual(expected)
        }
  const spans = [
    {start: 0, end: 1},
    {start: 2, end: 5},
    {start: 6, end: 9},
  ]
  expect(projectRedactionSpans(spans, segments, 'visible', 'raw')).toEqual([
    {start: 4, end: 5},
    {start: 11, end: 14},
    {start: 22, end: 23},
  ])
  expect(spans).toEqual([
    {start: 0, end: 1},
    {start: 2, end: 5},
    {start: 6, end: 9},
  ])
  expect(projectRedactionSpans(spans, [], 'visible', 'raw')).toEqual([])
})
