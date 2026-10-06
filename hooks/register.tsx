import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Kind, Labels, SeenMap } from '../types'
import { MAX_SHOWN, ageLabel, cleanSummary, newest } from './age'
import { KIND_COLOR, parseLabel } from './kind'

const now = atom({ plugin: 'mess-ages', key: 'now' } as const, 0)
const labels = atom({ plugin: 'mess-ages', key: 'labels' } as const, {} as Labels)

const SYSTEM =
  'You label chat messages. Reply with 2 to 8 very simple everyday words that say what the message is about. ' +
  'Use words a child knows. No punctuation, no quotes, nothing else.'

// Replies also say what kind of work they are doing, in the same call.
const REPLY_SYSTEM =
  'You label what an AI coding assistant is doing in one chat message. Reply as "kind: words". ' +
  'kind is one of: edit (changing or writing code or files), read (reading, searching, looking things up), ' +
  'run (running commands, tests or builds), other (answering, explaining, planning, anything else). ' +
  'words are 2 to 8 very simple everyday words that say what the message is about. ' +
  'Use words a child knows. No punctuation in the words, no quotes, nothing else.'

// Texts waiting for a summary, by message id; filled while drawing, drained by
// the tick. A text is summarized only once it is final: a prompt at once, a
// reply's text block when the next tool call starts or the turn ends (it never
// changes after that), and any reply drawn while no turn runs (a resumed
// session, or a reload after the turn ended). Each message is asked about once: its summary is stored
// by id, never by text, so a redraw can't trigger a second call.
const pending = new Map<string, { text: string; isFinal: boolean; isPrompt: boolean }>()
const asked = new Set<string>()
let isTurnRunning = false
let isBusy = false

// `other` keeps the plain dim colour: no color prop at all.
function colorOf(kind: Kind) {
  const color = KIND_COLOR[kind]
  return color ? { color } : {}
}

// Every reply text drawn so far is final: the model has moved on.
function finalizeReplies() {
  for (const p of pending.values()) p.isFinal = true
}

async function summarizeQueue($: EngineInterface) {
  if (isBusy) return
  isBusy = true
  try {
    for (const [id, { text, isFinal, isPrompt }] of [...pending]) {
      if (!isFinal) continue // still streaming
      pending.delete(id)
      if (asked.has(id)) continue
      asked.add(id)
      $.ui.log(`mess-ages: summarizing ${id}`, { to: 'debug' })
      const r = await $.model.complete({
        model: 'sonnet', effort: 'low', system: isPrompt ? SYSTEM : REPLY_SYSTEM,
        prompt: text.slice(0, 4000), maxTokens: 40,
      })
      if (!r.isAnswered) continue
      const label = isPrompt ? { kind: 'input' as const, words: cleanSummary(r.text) } : parseLabel(r.text)
      if (!label.words) continue
      await update($, labels, m => {
        const all = { ...m, [id]: label }
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
  on('tool.call', ($, e, next) => {
    finalizeReplies() // the text before a tool call is done
    return next(e)
  })
  on('turn.complete', ($, e, next) => {
    isTurnRunning = false
    finalizeReplies() // ended for any reason: done, interrupted, failed
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

    const summary = (await read($, labels))[id]
    if (summary === undefined && !asked.has(id) && e.props.text.trim()) {
      // A prompt is final as sent, a reply drawn between turns too; a reply
      // block of the running turn waits (latest text wins).
      const isFinal = e.component === 'UserMessage' || !isTurnRunning || (pending.get(id)?.isFinal ?? false)
      pending.set(id, { text: e.props.text, isFinal, isPrompt: e.component === 'UserMessage' })
    }

    const drawn = await next(e)
    const t = Math.max(await read($, now), seen[id])
    const age = ageLabel(t - seen[id])
    const { Box, Text } = $.ui.resolve(e)

    // Label on its own line below, so the message keeps the full width:
    // tables size themselves to the terminal and break if squeezed. The
    // summary is coloured by its kind of work, still dim so it stays quiet.
    return (
      <Box flexDirection="column">
        {drawn}
        <Box justifyContent="flex-end">
          <Text dimColor>{age}</Text>
          {summary && <Text dimColor {...colorOf(summary.kind)}>{` · ${summary.words}`}</Text>}
        </Box>
      </Box>
    )
  })
}
