import {join, resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {runPipe} from '@e2e/framework/pipe'

const dir = useTmpDir('emergency-terminal')
const repository = resolve(import.meta.dir, '../../../..')
const modulePath = (path: string) => JSON.stringify(join(repository, path))
const vectors = [
  {name: 'OSC52/BEL', raw: '\x1b]52;c;YXR0YWNrZXI=\x07', escaped: '\\u001b]52;c;YXR0YWNrZXI=\\u0007'},
  {name: 'CSI', raw: '\x1b[2J', escaped: '\\u001b[2J'},
  {name: 'C1 CSI', raw: '\u009b2J', escaped: '\\u009b2J'},
  {name: 'bidi', raw: '\u202e', escaped: '\\u202e'},
]
for (const vector of vectors)
  for (const silent of [false, true])
    it.each([false, true])(
      `AC-23 AC-26 emergency ${vector.name} is inert with silent=${silent}, report-failure=%s`,
      async (reportFailure) => {
        // Real source resolution/planning/transaction and command outcome, with injected filesystem faults.
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
        expect(result.exitCode).toBe(1)
        expect(stderr).toContain('Recovery required')
        expect(stderr.toLowerCase()).toContain(vector.escaped.toLowerCase())
        expect(stdout + stderr).not.toMatch(
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Bidi_Control}\u2028\u2029]/u,
        )
        if (silent) expect(stdout).toBe('')
      },
    )
