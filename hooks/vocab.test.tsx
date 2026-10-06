import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const HOME = '/tmp/mess-ages-test-home'
const FILE = `${HOME}/.claude/mess-ages/verbs.json`

// A temp HOME with an in-memory file system (the real verbs.json is never
// touched), and a model that answers every label with `answer`.
function setup($: any, on: any, answer: () => string, initial?: string) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const files = new Map<string, string>(initial === undefined ? [] : [[FILE, initial]])
  const systems: string[] = []
  let reads = 0
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? HOME : undefined }) as any)
  on('fs.read', (_$: any, e: any) => {
    reads++
    if (!files.has(e.path)) throw new Error('ENOENT')
    return { value: files.get(e.path) } as any
  })
  on('fs.write', (_$: any, e: any) => { files.set(e.path, e.text); return { value: undefined } as any })
  on('fs.exists', (_$: any, e: any) => ({ value: files.has(e.path) }) as any)
  on('model.complete', (_$: any, e: any) => {
    systems.push(e.system)
    return { value: { isAnswered: true, text: answer(), usage } } as any
  })
  on('session.start', () => ({ cwd: '/tmp' }) as any)
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }) as any)
  on('ui.log', () => ({ value: undefined }) as any)
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.panes', () => ({ value: [] }) as any)
  on('turn.complete', () => ({ text: 'done' }) as any)
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e) as any; return h(Text, {}, 'x') })
  const prompt = async (id: string) => {
    const props = { text: `message ${id}`, origin: { kind: 'prompt' }, isExpanded: true }
    const ui = await $.ui.mount({ plugin: 'mess-ages', surface: 'terminal', component: 'UserMessage', requestId: id, props } as any)
    await ui.unmount()
    await clock.advance(10_000)
  }
  const draw = async (component: string, id: string) => {
    const props = component === 'UserMessage'
      ? { text: `message ${id}`, origin: { kind: 'prompt' }, isExpanded: true }
      : { text: `message ${id}`, isFirstOfReply: true }
    const ui = await $.ui.mount({ plugin: 'mess-ages', surface: 'terminal', component, requestId: id, props } as any)
    const label = await ui.find({ type: 'Text', text: / · / })
    await ui.unmount()
    return JSON.stringify(label ?? null)
  }
  const start = async () => {
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as any)
    await $.turn.start({ text: 'go', turnId: 't1' } as any)
  }
  const verbs = async (args: string) => (await $.command.run({ command: 'ages', args: `verbs ${args}`.trim() } as any)).text
  return { clock, files, systems, prompt, draw, start, verbs, reads: () => reads }
}

test('a new verb used twice is promoted, saved and suggested; the file is read once', async ($, on) => {
  const w = setup($, on, () => 'tidy: imports | done: lint')
  await w.start()
  await w.prompt('m1')
  expect(JSON.parse(w.files.get(FILE)!)).toEqual({ learned: { tidy: 1, done: 1 }, promoted: [], removed: [] })
  expect(w.systems[0]).not.toContain('tidy')
  await w.prompt('m2')
  expect(JSON.parse(w.files.get(FILE)!).promoted).toEqual(['tidy'])
  await w.prompt('m3')
  expect(w.systems[2]).toMatch(/Prefer these verbs: [^.]*\btidy\b/)
  expect(w.reads()).toBe(1) // loaded once, kept in memory after
})

test('a corrupt verbs.json reads as empty and is replaced on the next save', async ($, on) => {
  const w = setup($, on, () => 'edit: remove cap & test', '{oops')
  await w.start()
  expect(await w.verbs('')).toContain('learned: none yet')
  await w.prompt('m1')
  expect(JSON.parse(w.files.get(FILE)!)).toEqual({ learned: { edit: 1 }, promoted: [], removed: [] })
})

test('/ages verbs lists, removes and resets; plain /ages auto still answers', async ($, on) => {
  const initial = JSON.stringify({ learned: { tidy: 4, zap: 1, edit: 2 }, promoted: ['tidy'], removed: [] })
  const w = setup($, on, () => 'tidy: imports', initial)
  await w.start()
  const list = await w.verbs('')
  expect(list).toContain('edit (2)')
  expect(list).toContain('tidy (4)')
  expect(list).toContain('pending: zap 1/2')

  expect(await w.verbs('remove tidy')).toContain('never learned or suggested again')
  expect(JSON.parse(w.files.get(FILE)!)).toEqual({ learned: { zap: 1, edit: 2 }, promoted: [], removed: ['tidy'] })
  await w.prompt('m1') // a removed verb is not counted again
  expect(JSON.parse(w.files.get(FILE)!).learned.tidy).toBeUndefined()
  expect(w.systems[0]).not.toMatch(/Prefer these verbs: [^.]*\btidy\b/)

  expect(await w.verbs('remove edit')).toContain('seed verb')
  expect(await w.verbs('reset')).toContain('cleared')
  expect(JSON.parse(w.files.get(FILE)!)).toEqual({ learned: {}, promoted: [], removed: [] })
  expect((await $.command.run({ command: 'ages', args: 'auto' } as any)).text).toContain('Auto-open is off')
})

test('multi-segment labels colour each verb; single ones keep the old colouring', async ($, on) => {
  let answer = 'edit: remove cap & test | test: run suite'
  const w = setup($, on, () => answer)
  await w.start()
  await w.draw('AssistantMessage', 'a1')
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, category: null, explanation: null } as any)
  await w.clock.advance(10_000)
  const multi = await w.draw('AssistantMessage', 'a1')
  expect(multi).toContain('edit: ')
  expect(multi).toContain('success') // edit is green
  expect(multi).toContain('warning') // test is amber
  expect(multi).toContain('remove cap & test')

  answer = 'read: config file'
  await w.draw('AssistantMessage', 'a2')
  await w.clock.advance(10_000)
  const single = await w.draw('AssistantMessage', 'a2')
  expect(single).toContain('"text":" · read: config file"')
  expect(single).toContain('merged') // read is purple, the whole label as before
})
