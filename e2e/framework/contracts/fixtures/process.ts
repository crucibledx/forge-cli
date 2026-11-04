import {writeFileSync} from 'node:fs'

const mode = Bun.argv[2]
if (mode === 'keys') {
  const readline = await import('node:readline')
  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.on('keypress', (str, key) => {
    console.log(JSON.stringify({str, key}))
    if (str === 'q') process.exit(0)
  })
  console.log('ready')
} else if (mode === 'flood') {
  const block = 'x'.repeat(8192)
  for (let i = 0; i < 100; i++) {
    process.stdout.write(block)
    process.stderr.write(block.replaceAll('x', 'y'))
  }
  process.stdout.write('stdout-end\n')
  process.stderr.write('stderr-end\n')
} else if (mode === 'unicode') {
  const bytes = new TextEncoder().encode('A🌍é終B\n')
  for (const byte of bytes) {
    await Bun.write(Bun.stdout, new Uint8Array([byte]))
    if (!process.stdout.isTTY) await Bun.write(Bun.stderr, new Uint8Array([byte]))
    await Bun.sleep(2)
  }
} else if (mode === 'prompts' || mode === 'input-exit') {
  process.stdin.setRawMode(true)
  process.stdout.write('prompt> ')
  process.stdin.on('data', (data) => {
    if (mode === 'input-exit' || data.toString().includes('q') || data.toString().includes('\x03')) process.exit(0)
    process.stdout.write('prompt> ')
  })
} else if (mode === 'batch') {
  console.log('first\nsecond\nfirst')
} else if (mode === 'early') {
  console.log('finished')
  process.exit(7)
} else if (mode === 'signal') {
  process.kill(process.pid, 'SIGTERM')
} else if (mode === 'env') {
  console.log(
    JSON.stringify({
      env: process.env,
      temp: (await import('node:os')).tmpdir(),
      home: (await import('node:os')).homedir(),
    }),
  )
} else if (mode === 'descendant') {
  const child = Bun.spawn([process.execPath, '-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
  const pids = JSON.stringify({parent: process.pid, child: child.pid})
  if (Bun.argv[3]) writeFileSync(Bun.argv[3], pids)
  console.log(pids)
  setInterval(() => {}, 1000)
} else if (mode === 'eof') {
  console.log(`eof:${await Bun.stdin.text()}`)
} else if (mode === 'hang') {
  console.log('ready')
  setInterval(() => {}, 1000)
} else throw new Error(`Unknown fixture: ${mode}`)
