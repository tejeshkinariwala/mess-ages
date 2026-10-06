import { test, expect, mock } from 'claude-code/testing'
import { GROUP_MARK } from './groups'

const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

// The message a label call was sent, out of its <message> tags.
const unwrap = (prompt: string) => /<message>\n([\s\S]*)\n<\/message>/.exec(prompt)?.[1] ?? prompt
// A temp HOME with an in-memory file system: the real verbs.json is never touched.
const fakeHome = (on: any) => {
  const files = new Map<string, string>()
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/tmp/mess-ages-test-home' : undefined }) as any)
  on('fs.read', (_$: any, e: any) => {
    if (!files.has(e.path)) throw new Error('ENOENT')
    return { value: files.get(e.path) } as any
  })
  on('fs.write', (_$: any, e: any) => { files.set(e.path, e.text); return { value: undefined } as any })
  on('fs.exists', (_$: any, e: any) => ({ value: files.has(e.path) }) as any)
  return files
}

// The world the plugin talks to: the model, the session, and the engine's panes.
function setup($: any, on: any) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const asked: string[] = []
  on('model.complete', (_$: any, e: any) => {
    // Grouping passes get no JSON: the panel stays the flat list these tests read.
    if (e.system.startsWith(GROUP_MARK)) return { value: { isAnswered: true, text: 'no groups', usage } } as any
    asked.push(unwrap(e.prompt))
    return { value: { isAnswered: true, text: `About ${unwrap(e.prompt)}`, usage } } as any
  })
  fakeHome(on)
  on('session.start', () => ({ cwd: '/tmp' }) as any)
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }) as any)
  on('ui.log', () => ({ value: undefined }) as any)
  on('command.register', () => ({ value: undefined }) as any)
  // The engine's panes, as the test sees them: open adds, close removes.
  const panes = { open: [] as string[] }
  on('ui.open', (_$: any, e: any) => { panes.open.push(e.id); return { value: { isPlaced: true } } as any })
  on('ui.close', (_$: any, e: any) => { panes.open = panes.open.filter(id => id !== e.id); return { value: undefined } as any })
  on('ui.panes', () => ({ value: panes.open.map(id => ({ id, title: 'Ages', isShown: true, isFocused: true, isPlaced: true })) }) as any)
  on('ui.scroll', () => ({ value: {} }) as any)
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e) as any; return h(Text, {}, 'x') })

  // Draws a prompt and returns its label line: the age Text and the summary Text.
  const draw = async (requestId: string, text: string) => {
    const props = { text, origin: { kind: 'prompt' }, isExpanded: true }
    const ui = await $.ui.mount({ plugin: 'mess-ages', surface: 'terminal', component: 'UserMessage', requestId, props } as any)
    const age = await ui.find({ type: 'Text', text: /just now|ago/ })
    const summary = await ui.find({ type: 'Text', text: / · / })
    await ui.unmount()
    return { age, summary: summary ? JSON.stringify(summary) : undefined }
  }
  const pane = async (surface: 'terminal' | 'desktop') => {
    const ui = await $.ui.mount({
      plugin: 'mess-ages', surface, component: 'Pane', requestId: 'ages',
      props: { title: 'Ages', isFocused: true, bodyColumns: 60, placement: 'dock' },
    } as any)
    const ages = (await ui.findAll({ type: 'Text', text: /^(now|\d+[sm]\+?)$/ })).map((t: any) => JSON.stringify(t))
    const summaries = (await ui.findAll({ type: 'Text', text: /about message/ })).map((t: any) => JSON.stringify(t))
    const separators = await ui.findAll({ type: 'Text', text: /·/ })
    const minimize = await ui.find({ type: 'Button', key: 'minimize' })
    const hidden = await ui.find({ type: 'Text', text: /no summary/ })
    const boxes = (await ui.findAll({ type: 'Box' })).map((b: any) => JSON.stringify(b))
    await ui.unmount()
    return { ages, summaries, separators, minimize, hidden: hidden ? JSON.stringify(hidden) : undefined, boxes }
  }
  return { clock, asked, panes, draw, pane }
}

test('every live message is labeled and summarized, past 20, on one timer', async ($, on) => {
  const { clock, asked, draw, pane } = setup($, on)
  // Each tick writes `now` once: count those writes.
  let ticks = 0
  on('state.set', ($, e: any, next) => { if (e.key === 'now') ticks++; return next(e) })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as any)
  await $.turn.start({ text: 'go', turnId: 't1' } as any)
  for (let i = 0; i < 30; i++) {
    await draw(`m${i}`, `message ${i}`)
    await clock.advance(1_000)
  }
  await clock.advance(10_000)
  expect(asked.length).toBe(30) // every live message asked about, no cap

  for (let i = 0; i < 30; i++) {
    const { age, summary } = await draw(`m${i}`, `message ${i}`)
    expect(age).toBeDefined()
    expect(summary).toContain(`about message ${i}`)
  }

  // One shared timer: one tick per 5s however many labels are drawn.
  const before = ticks
  await clock.advance(5_000)
  expect(ticks - before).toBe(1)

  // The panel lists every message, with no back-generation needed.
  await $.command.run({ command: 'ages' } as any)
  await clock.advance(10_000)
  expect(asked.length).toBe(30)
  const { ages, summaries, hidden } = await pane('terminal')
  expect(ages.length).toBe(30)
  expect(summaries.length).toBe(30)
  expect(hidden).toBeUndefined() // nothing without a summary
})

test('/ages back-generates the newest 20 old messages, lists all, and toggles', async ($, on) => {
  const { clock, asked, panes, draw, pane } = setup($, on)

  // A resumed session: 25 messages drawn before any prompt of this load.
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as any)
  for (let i = 0; i < 25; i++) {
    await draw(`m${i}`, `message ${i}`)
    await clock.advance(1_000)
  }
  await clock.advance(10_000)
  expect(asked).toEqual([]) // old messages wait for /ages
  const before = await draw('m24', 'message 24')
  expect(before.age).toBeDefined() // the age label shows at once
  expect(before.summary).toBeUndefined()

  const opened = await $.command.run({ command: 'ages' } as any)
  expect(opened.text).toContain('opened')
  expect(panes.open).toEqual(['ages'])
  await clock.advance(10_000)
  expect(asked.length).toBe(20) // capped at the newest 20
  expect(asked).toContain('message 24')
  expect(asked).toContain('message 5')
  expect(asked).not.toContain('message 4')

  for (const surface of ['terminal', 'desktop'] as const) {
    const { ages, summaries, minimize, hidden } = await pane(surface)
    expect(ages.length).toBe(20) // only rows with a summary
    expect(summaries.length).toBe(20)
    expect(hidden).toContain('5 earlier messages (no summary)') // the 5 oldest, counted
    expect(summaries[0]).toContain('about message 5') // oldest first
    expect(summaries[19]).toContain('about message 24')
    expect(minimize).toBeDefined()
  }

  // Inline too: the oldest keep the age label only.
  const oldest = await draw('m0', 'message 0')
  expect(oldest.age).toBeDefined()
  expect(oldest.summary).toBeUndefined()
  expect((await draw('m24', 'message 24')).summary).toContain('about message 24')

  const closed = await $.command.run({ command: 'ages' } as any)
  expect(closed.text).toContain('minimized')
  expect(panes.open).toEqual([])

  // Opening again does not go past the limit.
  await $.command.run({ command: 'ages' } as any)
  await clock.advance(10_000)
  expect(asked.length).toBe(20)

  // A new prompt is live again: summarized at once, no limit.
  await $.prompt.submit({ text: 'new one' } as any).catch(() => {})
  await $.turn.start({ text: 'new one', turnId: 't2' } as any)
  await draw('m25', 'message 25')
  await clock.advance(10_000)
  expect(asked.length).toBe(21)
  expect((await draw('m25', 'message 25')).summary).toContain('about message 25')
})

test('after a clear or resume, unsummarized rows collapse to one line', async ($, on) => {
  const { clock, asked, draw, pane } = setup($, on)

  // The history is drawn all at once: every message has the same first-seen time.
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as any)
  for (let i = 0; i < 28; i++) await draw(`m${i}`, `message ${i}`)

  // Before any summary exists: no rows of bare ages, one count line instead.
  const waiting = await pane('terminal')
  expect(waiting.ages.length).toBe(0)
  expect(waiting.hidden).toContain('28 earlier messages (no summary)')

  await $.command.run({ command: 'ages' } as any)

  await clock.advance(10_000)
  expect(asked.length).toBe(20)
  for (const surface of ['terminal', 'desktop'] as const) {
    const { ages, summaries, separators, hidden, boxes } = await pane(surface)
    expect(ages.length).toBe(20)
    expect(summaries.length).toBe(20)
    expect(summaries[0]).toContain('about message 8')
    expect(hidden).toContain('8 earlier messages (no summary)')
    // No " · " separator before panel summaries.
    expect(separators.length).toBe(0)
    // Panel ages are short, with no "ago".
    expect(ages.some((a: string) => a.includes('ago'))).toBe(false)
    // The age sits in a fixed-width column that never shrinks.
    expect(boxes.some((b: string) => b.includes('"width":5') && b.includes('"flexShrink":0'))).toBe(true)
  }
})
