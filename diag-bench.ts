import {copyFileSync, mkdtempSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {spawnOwnedPipe} from './e2e/framework/owned-pipe'
import {terminateTree} from './e2e/framework/process'
import {createTestSandbox} from './scripts/test-sandbox'

const ms = (t: number) => Math.round(performance.now() - t)
let t = performance.now()
const first = createTestSandbox('bench-first-')
void first.env
const exe = join(first.root, 'bin', 'schtasks.exe')
console.log('compile+first-copy ms', ms(t), 'size', statSync(exe).size)
for (let i = 0; i < 5; i++) {
  const s = createTestSandbox('bench-copy-')
  t = performance.now()
  void s.env
  const copy = ms(t)
  t = performance.now()
  s.dispose()
  console.log('sandbox env copy ms', copy, 'dispose ms', ms(t))
}
const scratch = mkdtempSync(join(tmpdir(), 'bench-cf-'))
for (let i = 0; i < 5; i++) {
  t = performance.now()
  copyFileSync(exe, join(scratch, `s${i}.exe`))
  console.log('copyFileSync ms', ms(t))
}
for (let i = 0; i < 3; i++) {
  t = performance.now()
  const r = Bun.spawnSync([join(scratch, `s${i}.exe`), '/query', '/tn', 'x'], {env: first.env, stdout: 'pipe', stderr: 'pipe'})
  console.log('first exec of fresh copy ms', ms(t), 'exit', r.exitCode)
}
for (let i = 0; i < 3; i++) {
  t = performance.now()
  const r = Bun.spawnSync([process.execPath, '-e', '0'], {env: first.env})
  console.log('plain bun -e 0 ms', ms(t), r.exitCode)
}
for (let i = 0; i < 3; i++) {
  t = performance.now()
  const p = await spawnOwnedPipe([process.execPath, '-e', '0'], first.project, first.env)
  await p.exited
  await terminateTree(p, first.env)
  console.log('owned bun -e 0 ms', ms(t))
}
for (let i = 0; i < 3; i++) {
  t = performance.now()
  const r = Bun.spawnSync([process.execPath, 'test', '--preload', './scripts/test-preload.ts', 'src/domain/redact.test.ts'], {env: first.env, stdout: 'pipe', stderr: 'pipe'})
  console.log('bun test with preload (one small file) ms', ms(t), r.exitCode)
}
first.dispose()
