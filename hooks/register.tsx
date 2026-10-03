import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SeenMap, Summaries } from '../types'
import { MAX_SHOWN, ageLabel, cleanSummary, newest } from './age'

const now = atom({ plugin: 'mess-ages', key: 'now' } as const, 0)
const summaries = atom({ plugin: 'mess-ages', key: 'summaries' } as const, {} as Summaries)

const SYSTEM =
  'You label chat messages. Reply with 2 to 8 very simple everyday words that say what the message is about. ' +
  'Use words a child knows. No punctuation, no quotes, nothing else.'

// Texts waiting for a summary, by message id; filled while drawing, drained by
// the tick. A reply's text keeps changing until its turn ends, so nothing is
// summarized while a turn runs. Each message is asked about once: its summary
// is stored by id, never by text, so a redraw can't trigger a second call.
const pending = new Map<string, string>()
const asked = new Set<string>()
let isTurnRunning = false
let isBusy = false

async function summarizeQueue($: EngineInterface) {
  if (isBusy || isTurnRunning) return
  isBusy = true
  try {
    for (const [id, text] of [...pending]) {
      if (isTurnRunning) break // a new turn started: its texts are not final yet
      pending.delete(id)
      if (asked.has(id)) continue
      asked.add(id)
      $.ui.log(`mess-ages: summarizing ${id}`, { to: 'debug' })
      const r = await $.model.complete({
        model: 'sonnet', effort: 'low', system: SYSTEM, prompt: text.slice(0, 4000), maxTokens: 40,
      })
      const words = r.isAnswered ? cleanSummary(r.text) : ''
      if (!words) continue
      await update($, summaries, m => {
        const all = { ...m, [id]: words }
        const keys = Object.keys(all)
        for (const old of keys.slice(0, Math.max(0, keys.length - MAX_SHOWN * 3))) delete all[old]
        return all
      })
    }
  } finally {
    isBusy = false
  }
}

export const register: Register = on => {
  // First-seen times live in module memory: render hooks may not write $.state.
  const seen: SeenMap = {}
  on('session.start', async ($, e, next) => {
    const t = await $.clock.now()
    await update($, now, () => t)
    // Every 5s: renders that read `now` redraw when a label can change, and
    // queued texts get summarized outside of drawing.
    $.clock.every(5000, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
      void summarizeQueue($)
    })
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    isTurnRunning = true
    return next(e)
  })
  on('turn.complete', ($, e, next) => {
    isTurnRunning = false // ended for any reason: done, interrupted, failed
    return next(e)
  })

  on('ui.render', { component: ['UserMessage', 'AssistantMessage'] }, async ($, e, next) => {
    if (e.component === 'AssistantMessage' && !e.props.isFirstOfReply) return next(e)

    const id = e.requestId
    if (seen[id] === undefined) {
      seen[id] = await $.clock.now()
      const drop = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(MAX_SHOWN * 2)
      for (const [old] of drop) delete seen[old]
    }
    if (!newest(seen).has(id)) return next(e)

    const summary = (await read($, summaries))[id]
    if (summary === undefined && !asked.has(id) && e.props.text.trim()) pending.set(id, e.props.text) // latest text wins

    const drawn = await next(e)
    const t = Math.max(await read($, now), seen[id])
    const label = ageLabel(t - seen[id]) + (summary ? ` · ${summary}` : '')
    const { Box, Text } = $.ui.resolve(e)

    // Label on its own line below, so the message keeps the full width:
    // tables size themselves to the terminal and break if squeezed.
    return (
      <Box flexDirection="column">
        {drawn}
        <Box justifyContent="flex-end">
          <Text dimColor>{label}</Text>
        </Box>
      </Box>
    )
  })
}
