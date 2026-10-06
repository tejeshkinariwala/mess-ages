import { test, expect, mock } from 'claude-code/testing'

test('user message gets a label', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e as any) as any; return h(Text, {}, 'hello') as any })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'mess-ages', surface, component: 'UserMessage', requestId: 'm1',
      props: { text: 'hello', origin: { kind: 'prompt' }, isExpanded: true },
    } as any)
    expect(await ui.find({ type: 'Text', text: /just now|ago/ })).toBeDefined()
    await ui.unmount()
  }
})
