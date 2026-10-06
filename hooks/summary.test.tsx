import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

test('prompts at once, reply blocks at the next tool call or turn end, once each', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const asked: string[] = []
  on('model.complete', (_$, e: any) => {
    asked.push(e.prompt)
    const kind = e.system.includes('kind:') ? 'run: ' : '' // replies say their kind
    return { value: { isAnswered: true, text: `${kind}About ${e.prompt}`, usage } } as any
  })
  on('session.start', () => ({ cwd: '/tmp' }) as any)
  on('ui.log', () => ({ value: undefined }) as any)
  on('turn.start', (_$, e: any) => ({ turnId: e.turnId }) as any)
  on('turn.complete', () => ({ text: 'done' }) as any)
  on('tool.call', () => ({ result: { text: 'ok' } }) as any)
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e as any) as any; return h(Text, {}, 'x') })
  const draw = async (component: 'UserMessage' | 'AssistantMessage', requestId: string, text: string) => {
    const props = component === 'UserMessage'
      ? { text, origin: { kind: 'prompt' }, isExpanded: true }
      : { text, isFirstOfReply: true }
    const ui = await $.ui.mount({ plugin: 'mess-ages', surface: 'terminal', component, requestId, props } as any)
    const label = await ui.find({ type: 'Text', text: / · / })
    await ui.unmount()
    return JSON.stringify(label ?? null)
  }

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as any)
  await $.turn.start({ text: 'prompt', turnId: 't1' } as any)

  await draw('UserMessage', 'u1', 'prompt')
  await draw('AssistantMessage', 'a1', 'first')
  await draw('AssistantMessage', 'a1', 'first block') // still streaming
  await clock.advance(10_000)
  expect(asked).toEqual(['prompt']) // the prompt at once, mid-turn

  await $.tool.call({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu1' } as any)
  await clock.advance(10_000)
  expect(asked).toEqual(['prompt', 'first block']) // final text, after the tool call started
  const reply = await draw('AssistantMessage', 'a1', 'first block')
  expect(reply).toContain('about first block')
  expect(reply).toContain('warning') // a run is coloured amber
  const prompt = await draw('UserMessage', 'u1', 'prompt')
  expect(prompt).toContain('about prompt')
  expect(prompt).toContain('suggestion') // your input is coloured blue

  await draw('AssistantMessage', 'a2', 'last block')
  await clock.advance(10_000)
  expect(asked.length).toBe(2) // the last block waits for the turn to end

  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false, category: null, explanation: null } as any)
  await clock.advance(10_000)
  expect(asked).toEqual(['prompt', 'first block', 'last block'])

  await draw('UserMessage', 'u1', 'prompt')
  await draw('AssistantMessage', 'a1', 'first block')
  await clock.advance(20_000)
  expect(asked.length).toBe(3) // redraws do not ask again

  await draw('AssistantMessage', 'old', 'from an earlier turn') // no turn running: a resumed session
  await clock.advance(10_000)
  expect(asked[3]).toBe('from an earlier turn')
})
