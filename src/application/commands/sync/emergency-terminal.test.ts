import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {readTree} from '@e2e/commands/sync/safety/helpers'
import {runPipe} from '@e2e/framework/pipe'

import {testEnvironment} from '../../../../scripts/test-sandbox'

const dir = useTmpDir('emergency-terminal')
const repository = resolve(import.meta.dir, '../../../..')
const modulePath = (path: string) => JSON.stringify(join(repository, path))
it.each([
  'https://user:X_PERSISTED_PRIVATE',
  'https://X_PERSISTED_PRIVATE',
  'https://fixture.invalid?to\x1b[31mken=X_PERSISTED_PRIVATE&visible=yes',
])(
  'AC-15,30 injected handler stdout/latest/history/logs retain no unfinished/formatted credential: %s',
  async (value) => {
    const root = dir(),
      home = testEnvironment(root).HOME
    const program = `
    import {handlerFixture,protectedBytes} from ${modulePath('src/test-helpers/sync-fixture.ts')};
    import {runSyncWithDependencies} from ${modulePath('src/application/commands/sync/handler.ts')};
    const f=await handlerFixture(process.cwd()), before=await protectedBytes(process.cwd());
    await runSyncWithDependencies({dryRun:false,verbose:false,silent:false},{
      io:f.dependencies.io,loadSource:async()=>{throw new Error(${JSON.stringify('Git clone failed early: ' + value)})}
    });
    console.log('PROTECTED_UNCHANGED='+(JSON.stringify(before)===JSON.stringify(await protectedBytes(process.cwd()))));
  `
    let raw = ''
    const result = await runPipe(root, [process.execPath, '-e', program], {
      inspectRaw: (stdout, stderr) => {
        raw = stdout + stderr
      },
    })
    expect(result.exitCode).toBe(1)
    expect(raw).toContain('PROTECTED_UNCHANGED=true')
    const artifacts = raw + (await readTree(join(home, '.crucible/forge')))
    expect(artifacts).not.toContain('X_PERSISTED_PRIVATE')
    expect(artifacts).toContain('[redacted]')
    if (value.includes('visible=yes')) expect(artifacts).toContain('visible=yes')
    const latest = JSON.parse(await readFile(join(home, '.crucible/forge/reports/latest.json'), 'utf8'))
    expect(latest.success).toBe(false)
    expect(latest.files.synced).toBe(0)
  },
)
const vectors = [
  {name: 'OSC52/BEL', raw: '\x1b]52;c;YXR0YWNrZXI=\x07', escaped: '\\u001b]52;c;YXR0YWNrZXI=\\u0007'},
  {name: 'CSI', raw: '\x1b[2J', escaped: '\\u001b[2J'},
  {name: 'C1 CSI', raw: '\u009b2J', escaped: '\\u009b2J'},
  {name: 'bidi', raw: '\u202e', escaped: '\\u202e'},
  {name: 'credential-looking path', raw: 'api_key="AI_PATH_PRIVATE', escaped: 'api_key=[redacted]'},
]
for (const vector of vectors)
  for (const silent of [false, true])
    for (const reportFailure of [false, true])
      it(`AC-23 AC-26 emergency ${vector.name} is inert with silent=${silent}, report-failure=${reportFailure}`, async () => {
        // Application-boundary subprocess: real planning/transaction/outcome with injected filesystem faults.
        // No invalid native filename is created, so Windows exercises the same diagnostic boundary.
        const program = `
          import {handlerFixture} from ${modulePath('src/test-helpers/sync-fixture.ts')};
          import {runSyncWithDependencies} from ${modulePath('src/application/commands/sync/handler.ts')};
          import {transactionIO} from ${modulePath('src/infrastructure/fs/transaction.ts')};
          const f = await handlerFixture(process.cwd());
          let replacements=0,reportAttempted=false;
          try {
            await runSyncWithDependencies({dryRun:false,silent:${silent},verbose:false},{
              ...f.dependencies,
              loadSource:async()=>[{relativePath:'rules/a'+${JSON.stringify(vector.raw)}+'.md',content:'incoming'}],
              reports:{...f.dependencies.reports,writeReport:async(report)=>{
                reportAttempted=true;
                if(${reportFailure})throw Error('injected report storage failure');
                return f.dependencies.reports.writeReport(report);
              }},
              transaction:{...transactionIO,
                checkPrivateTemporarySupport:async()=>{},
                lstat:async(path)=>/\\.(md|bak|json|yaml)$/.test(path)?{isFile:()=>true,mode:384}:{isDirectory:()=>true},
                readFile:async()=>Buffer.from('before'),readAccessMetadata:async()=>null,
                access:async()=>{},writeTemp:async()=>{},chmod:async()=>{},unlink:async()=>{},
                replace:async()=>{replacements++;throw Error('injected replacement and compensation failure')}
              }
            });
          }catch{process.exitCode=1}
          if(replacements<2||!reportAttempted)throw Error('Fixture did not exercise apply, compensation and report storage');
        `
        let stdout = '',
          stderr = ''
        const result = await runPipe(dir(), [process.execPath, '-e', program], {
          inspectRaw: (out, err) => {
            stdout = out
            stderr = err
          },
        })
        expect(result).toMatchObject({exitCode: 1, signal: null, timedOut: false})
        expect(stderr).toContain('Recovery required')
        expect(stderr).toContain('Preserve files/backups and recovery temporaries:')
        expect(stderr).toContain('Restore target/config/state from one known-good snapshot, then dry-run.')
        expect(stderr).toContain('Do not retry writes using untrusted metadata.')
        expect(stderr).not.toContain('AI_PATH_PRIVATE')
        expect(stderr.toLowerCase()).toContain(vector.escaped.toLowerCase())
        expect(stdout + stderr).not.toMatch(
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Bidi_Control}\u2028\u2029]/u,
        )
        if (silent) expect(stdout).toBe('')
      })
