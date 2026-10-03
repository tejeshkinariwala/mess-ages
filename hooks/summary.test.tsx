import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

test('one summary per message, after the turn ends', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let calls = 0
  on('model.complete', () => { calls++; return { value: { isAnswered: true, text: 'Fix The Login Bug', usage } } as any })
  on('session.start', () => ({ cwd: '/tmp' }) as any)
  on('ui.log', () => ({}) as any)
  on('turn.start', (_$, e: any) => ({ turnId: e.turnId }) as any)
  on('turn.complete', () => ({ text: 'done' }) as any)
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e as any) as any; return h(Text, {}, 'hello') })
  const mount = () => $.ui.mount({
    plugin: 'mess-ages', surface: 'terminal', component: 'UserMessage', requestId: 'm1',
    props: { text: 'please fix the login bug', origin: { kind: 'prompt' }, isExpanded: true },
  } as any)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as any)
  await $.turn.start({ text: 'please fix the login bug', turnId: 't1' } as any)
  let ui = await mount()
  await clock.advance(10_000)
  expect(calls).toBe(0) // nothing while the turn runs
  await ui.unmount()

  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false, category: null, explanation: null } as any)
  await clock.advance(10_000)
  expect(calls).toBe(1)
  ui = await mount()
  expect(await ui.find({ type: 'Text', text: /fix the login bug/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(20_000)
  ui = await mount()
  expect(calls).toBe(1) // a redraw does not ask again
  await ui.unmount()
})
