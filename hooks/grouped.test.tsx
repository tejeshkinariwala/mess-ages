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

// The world the plugin talks to. `group` answers each grouping pass from
// the rows it was sent; every pass's prompt is kept.
function setup($: any, on: any, group: (n: number) => string) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const passes: string[] = []
  on('model.complete', (_$: any, e: any) => {
    if (e.system.startsWith(GROUP_MARK)) {
      passes.push(e.prompt)
      return { value: { isAnswered: true, text: group(e.prompt.split('\n').length), usage } } as any
    }
    return { value: { isAnswered: true, text: `About ${unwrap(e.prompt)}`, usage } } as any
  })
  fakeHome(on)
  on('session.start', () => ({ cwd: '/tmp' }) as any)
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }) as any)
  on('ui.log', () => ({ value: undefined }) as any)
  on('command.register', () => ({ value: undefined }) as any)
  let open: string[] = []
  on('ui.open', (_$: any, e: any) => { open.push(e.id); return { value: { isPlaced: true } } as any })
  on('ui.close', (_$: any, e: any) => { open = open.filter(id => id !== e.id); return { value: undefined } as any })
  on('ui.panes', () => ({ value: open.map(id => ({ id, title: 'Ages', isShown: true, isFocused: true, isPlaced: true })) }) as any)
  on('ui.scroll', () => ({ value: {} }) as any)
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e) as any; return h(Text, {}, 'x') })

  // Draws n live prompts from `from` and waits for their summaries.
  const add = async (n: number, from: number) => {
    for (let i = from; i < from + n; i++) {
      const props = { text: `message ${i}`, origin: { kind: 'prompt' }, isExpanded: true }
      const ui = await $.ui.mount({ plugin: 'mess-ages', surface: 'terminal', component: 'UserMessage', requestId: `m${i}`, props } as any)
      await ui.unmount()
    }
    await clock.advance(10_000) // a tick to summarize, the next to see them
  }
  const mount = (surface: 'terminal' | 'desktop') => $.ui.mount({
    plugin: 'mess-ages', surface, component: 'Pane', requestId: 'ages',
    props: { title: 'Ages', isFocused: true, bodyColumns: 60, placement: 'dock' },
  } as any)
  const read = async (ui: any) => ({
    headers: (await ui.findAll({ type: 'Button' })).map((b: any) => JSON.stringify(b)).filter((b: string) => b.includes('group:')),
    summaries: (await ui.findAll({ type: 'Text', text: /about message/ })).map((t: any) => JSON.stringify(t)),
  })
  const start = async () => {
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as any)
    await $.turn.start({ text: 'go', turnId: 't1' } as any)
  }
  return { clock, passes, add, mount, read, start }
}

// Two groups over the rows sent: all but the newest two, then those two.
const twoGroups = (n: number) => JSON.stringify({
  groups: n > 2
    ? [{ start: 0, end: n - 3, title: `done ${n}` }, { start: n - 2, end: n - 1, title: `doing ${n}` }]
    : [{ start: 0, end: n - 1, title: `doing ${n}` }],
})

test('/ages groups the rows: closed collapsed, open expanded, then In progress', async ($, on) => {
  const { clock, passes, add, mount, read, start } = setup($, on, twoGroups)
  await start()
  await add(6, 0)
  expect(passes.length).toBe(0) // the panel is closed: no pass

  await $.command.run({ command: 'ages' } as any)
  await clock.advance(10)
  expect(passes.length).toBe(1)
  expect(passes[0]!).toContain('0. ')
  expect(passes[0]!).toContain('about message 0')

  await add(2, 6) // two rows: under the threshold, no pass
  expect(passes.length).toBe(1)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount(surface)
    const { headers, summaries } = await read(ui)
    expect(headers.length).toBe(3)
    expect(headers[0]).toContain('▸ done 6 (4)') // closed: collapsed
    expect(headers[1]).toContain('▾ doing 6 (2)') // open: expanded
    expect(headers[2]).toContain('▾ In progress (2)')
    expect(summaries.length).toBe(4) // the collapsed group's 4 rows are hidden
    expect(summaries[0]).toContain('about message 4')
    await ui.unmount()
  }

  {
    const ui = await mount('terminal')
    // Enter on a header toggles it; c collapses all; e expands all.
    await ui.press({ key: 'group:m0' })
    expect((await read(ui)).summaries.length).toBe(8)
    await ui.press({ key: 'group:m0' })
    expect((await read(ui)).summaries.length).toBe(4)
    await ui.press({ key: 'collapse' })
    const folded = await read(ui)
    expect(folded.summaries.length).toBe(0)
    expect(folded.headers.every((h: string) => h.includes('▸'))).toBe(true)
    await ui.press({ key: 'expand' })
    expect((await read(ui)).summaries.length).toBe(8)
    expect(await ui.find({ type: 'Button', key: 'minimize' })).toBeDefined()
    await ui.press({ key: 'collapse' })
    await ui.unmount()
  }

  // Three more rows make five since the pass: the next one sends only the open
  // group and the new rows; the closed group and its fold stay as they were.
  await add(3, 8)
  expect(passes.length).toBe(2)
  expect(passes[1]!).not.toContain('about message 3')
  expect(passes[1]!).toContain('about message 4')
  expect(passes[1]!.split('\n').length).toBe(7) // m4..m10

  const ui = await mount('terminal')
  const { headers } = await read(ui)
  expect(headers.map((h: string) => h.match(/[▸▾] [a-z]+ \d+ \(\d+\)/)?.[0])).toEqual([
    '▸ done 6 (4)', // frozen, still collapsed
    '▸ done 7 (5)', // the open group's earlier part, now closed
    '▾ doing 7 (2)',
  ])
  await ui.unmount()
})

test('a reply that is not valid grouping JSON keeps the flat list', async ($, on) => {
  const { clock, passes, add, mount, read, start } = setup($, on, n => JSON.stringify({ groups: [{ start: 0, end: n, title: 'x' }] }))
  await start()
  await add(4, 0)
  await $.command.run({ command: 'ages' } as any)
  await clock.advance(10)
  expect(passes.length).toBe(1)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount(surface)
    const { headers, summaries } = await read(ui)
    expect(headers.length).toBe(0)
    expect(summaries.length).toBe(4)
    expect(await ui.find({ type: 'Button', key: 'collapse' })).toBeUndefined()
    await ui.unmount()
  }
  // No retry until PASS_EVERY more rows.
  await add(4, 4)
  expect(passes.length).toBe(1)
  await add(1, 8)
  expect(passes.length).toBe(2)
})

test('a long session sends at most MAX_PASS_ROWS rows in a pass', async ($, on) => {
  const { clock, passes, add, mount, read, start } = setup($, on, twoGroups)
  await start()
  await add(40, 0)
  await $.command.run({ command: 'ages' } as any)
  await clock.advance(10)
  expect(passes.length).toBe(1)
  expect(passes[0]!.split('\n').length).toBe(30)
  expect(passes[0]!).not.toContain('about message 9\n')
  expect(passes[0]!).toContain('about message 10')
  const ui = await mount('terminal')
  const { headers } = await read(ui)
  expect(headers[0]).toContain('Earlier messages (10)')
  await ui.unmount()
})
