import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

// An offline command backend. Never delegates to an OS scheduler.
const args = Bun.argv.slice(2)
const command = process.platform === 'win32' ? 'schtasks' : args.shift()
const state = join(process.env.HOME!, '.fake-scheduler')
if (command === 'crontab') {
  if (args[0] === '-l') {
    if (!existsSync(state)) process.exit(1)
    process.stdout.write(readFileSync(state))
  } else if (args[0] === '-') writeFileSync(state, await Bun.stdin.text())
  else process.exit(2)
} else if (command === 'schtasks') {
  const tasks: string[] = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : []
  const title = args[args.indexOf('/tn') + 1]
  if (args[0] === '/query') process.exit(tasks.includes(title) ? 0 : 1)
  if (args[0] === '/create') tasks.push(title)
  writeFileSync(state, JSON.stringify(args[0] === '/delete' ? tasks.filter((t) => t !== title) : tasks))
} else if (command !== 'launchctl') process.exit(2)
