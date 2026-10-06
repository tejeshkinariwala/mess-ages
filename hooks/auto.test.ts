import { test, expect, mock } from 'claude-code/testing'

const FLAG = '/home/me/.claude/.mess-ages-always'

// The world the plugin talks to, with a file system holding at most the flag.
function setup(on: any, hasFlag: boolean, isReadable = true) {
  mock.clock(on, { now: 1_000_000 })
  const files = new Set<string>(hasFlag ? [FLAG] : [])
  const opened: any[] = []
  on('session.start', () => ({ cwd: '/tmp' }) as any)
  on('ui.log', () => ({ value: undefined }) as any)
  on('command.register', () => ({ value: undefined }) as any)
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as any)
  on('fs.exists', (_$: any, e: any) => {
    if (!isReadable) throw new Error('EACCES')
    return { value: files.has(e.path) } as any
  })
  on('fs.write', (_$: any, e: any) => { files.add(e.path); return { value: undefined } as any })
  on('process.run', (_$: any, e: any) => {
    if (e.argv[0] === 'rm') files.delete(e.argv[e.argv.length - 1])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as any
  })
  on('ui.open', (_$: any, e: any) => { opened.push(e); return { value: { isPlaced: true } } as any })
  on('ui.panes', () => ({ value: [] }) as any)
  on('ui.scroll', () => ({ value: {} }) as any)
  return { files, opened }
}

const start = ($: any) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as any)

test('with the flag file, the panel opens at session start, unfocused', async ($, on) => {
  const { opened } = setup(on, true)
  await start($)
  expect(opened.length).toBe(1)
  expect(opened[0].id).toBe('ages')
  expect(opened[0].focus).toBeUndefined() // the prompt keeps the keys
})

test('without the flag file, the panel stays closed', async ($, on) => {
  const { opened } = setup(on, false)
  await start($)
  expect(opened.length).toBe(0)
})

test('an unreadable flag counts as off', async ($, on) => {
  const { opened } = setup(on, true, false)
  await start($)
  expect(opened.length).toBe(0)
})

test('/ages auto on, off and status toggle the flag file', async ($, on) => {
  const { files, opened } = setup(on, false)
  await start($)

  expect((await $.command.run({ command: 'ages', args: 'auto' } as any)).text).toContain('off')
  const on1 = await $.command.run({ command: 'ages', args: 'auto on' } as any)
  expect(on1.text).toContain('on')
  expect(files.has(FLAG)).toBe(true)
  expect((await $.command.run({ command: 'ages', args: 'auto' } as any)).text).toContain('is on')

  await $.command.run({ command: 'ages', args: 'auto off' } as any)
  expect(files.has(FLAG)).toBe(false)
  expect((await $.command.run({ command: 'ages', args: 'auto' } as any)).text).toContain('is off')
  expect(opened.length).toBe(0) // the toggle never opens the panel

  // Plain /ages still opens it, focused.
  await $.command.run({ command: 'ages', args: '' } as any)
  expect(opened.length).toBe(1)
  expect(opened[0].focus).toBe(true)
})
