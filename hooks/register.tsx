import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Kind, Labels } from '../types'
import { ageLabel, cleanSummary } from './age'
import { KIND_COLOR, parseLabel } from './kind'
import { markSeen, pickBackfill, resetSeen, rows, seen } from './store'

const now = atom({ plugin: 'mess-ages', key: 'now' } as const, 0)
const labels = atom({ plugin: 'mess-ages', key: 'labels' } as const, {} as Labels)

// The side panel listing every message's age and summary, opened by /ages.
const PANE = 'ages'
// While this hidden file exists, the panel opens at the start of each session.
const AUTO_FLAG = '.claude/.mess-ages-always'
// The panel's age column: wide enough for the longest short age, `30m+`, plus a space.
const AGE_WIDTH = 5

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
// changes after that), and any reply drawn between turns. Each message is
// asked about once: its summary is stored by id, never by text, so a redraw
// can't trigger a second call. Live messages have no limit.
const pending = new Map<string, { text: string; isFinal: boolean; isPrompt: boolean }>()
const asked = new Set<string>()
let isTurnRunning = false
let isBusy = false
// Live once this load has seen a prompt or a turn. Messages first drawn before
// that are old (a resumed session's history, or a reload's redraw): they get
// the age label at once, and a summary only by back-generation when /ages
// opens, for the newest BACKFILL_LIMIT of them without one.
let isLive = false
const oldIds = new Set<string>()
const old = new Map<string, { text: string; isPrompt: boolean }>() // their texts
const backfilled = new Set<string>()

// `other` keeps the plain dim colour: no color prop at all.
function colorOf(kind: Kind) {
  const color = KIND_COLOR[kind]
  return color ? { color } : {}
}

// Every reply text drawn so far is final: the model has moved on.
function finalizeReplies() {
  for (const p of pending.values()) p.isFinal = true
}

// Queues the newest old messages without a summary, BACKFILL_LIMIT in all for
// this load; older ones keep the age label alone.
async function backfill($: EngineInterface) {
  const all = await read($, labels)
  const candidates = Object.keys(seen).filter(id => old.has(id) && !all[id] && !asked.has(id))
  for (const id of pickBackfill(candidates, backfilled)) {
    backfilled.add(id)
    pending.set(id, { ...old.get(id)!, isFinal: true })
  }
  if (pending.size) void summarizeQueue($)
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
      // Kept for every message: the panel lists the whole session.
      await update($, labels, m => ({ ...m, [id]: label }))
    }
  } finally {
    isBusy = false
  }
}

// The flag file's full path, or undefined with no HOME.
async function flagPath($: EngineInterface) {
  const home = await $.env.get('HOME')
  return home ? `${home}/${AUTO_FLAG}` : undefined
}

// Missing, unreadable or no HOME: off.
async function isAutoOn($: EngineInterface) {
  const path = await flagPath($).catch(() => undefined)
  return path ? $.fs.exists(path).catch(() => false) : false
}

// Opens the panel, back-generating summaries first. Focused only when the
// person asked for it: an automatic open leaves the keys with the prompt.
async function openPanel($: EngineInterface, focus: boolean) {
  await backfill($)
  // Focused so the arrows scroll it; Escape hands the keys back and closes it.
  const opened = await $.ui.open({ id: PANE, title: 'Ages', closeOnEscape: true, ...(focus ? { focus: true } : {}) })
  if (opened.isPlaced) void $.ui.scroll({ in: PANE, to: 'end' }).catch(() => {}) // newest in view
}

// `/ages auto on|off` creates or removes the flag file; `/ages auto` reports it.
async function autoCommand($: EngineInterface, arg: string) {
  const path = await flagPath($)
  if (!path) return 'Auto-open unavailable: HOME is not set.'
  if (arg === 'on') {
    await $.fs.write(path, '')
    return `Auto-open on: the Ages panel opens at the start of each session (${path}).`
  }
  if (arg === 'off') {
    await $.process.run(['rm', '-f', path])
    return 'Auto-open off.'
  }
  return (await isAutoOn($))
    ? `Auto-open is on (${path} exists). /ages auto off turns it off.`
    : 'Auto-open is off. /ages auto on turns it on.'
}

export const register: Register = on => {
  // A fresh load starts with nothing seen and nothing live.
  resetSeen()
  for (const c of [pending, asked, oldIds, old, backfilled]) c.clear()
  isLive = false
  isTurnRunning = false
  on('session.start', async ($, e, next) => {
    const t = await $.clock.now()
    await update($, now, () => t)
    // A failed registration costs the panel alone, never the labels.
    await $.command.register({
      name: 'ages',
      description: 'Toggle a side panel listing every message\'s age and summary; /ages auto on|off opens it each session',
    }).catch(err => $.ui.log(`mess-ages: /ages not registered: ${err}`, { to: 'debug' }))
    // The one timer for every label, however many: every 5s it moves `now`, so
    // renders that read it redraw when a label can change, and it drains the
    // queued texts outside of drawing.
    $.clock.every(5000, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
      void summarizeQueue($)
    })
    const started = await next(e)
    if (await isAutoOn($)) {
      await openPanel($, false).catch(err => $.ui.log(`mess-ages: auto-open failed: ${err}`, { to: 'debug' }))
    }
    return started
  })

  on('prompt.submit', ($, e, next) => {
    isLive = true
    return next(e)
  })
  on('turn.start', ($, e, next) => {
    isLive = true
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
    const isOld = oldIds.has(id) || (seen[id] === undefined && !isLive)
    if (isOld) oldIds.add(id)
    const first = markSeen(id, await $.clock.now())
    const isPrompt = e.component === 'UserMessage'

    const summary = (await read($, labels))[id]
    if (summary === undefined && !asked.has(id) && e.props.text.trim()) {
      if (isOld) {
        // Kept for back-generation; asked about only if picked when /ages opens.
        old.set(id, { text: e.props.text, isPrompt })
      } else {
        // A prompt is final as sent, a reply drawn between turns too; a reply
        // block of the running turn waits (latest text wins).
        const isFinal = isPrompt || !isTurnRunning || (pending.get(id)?.isFinal ?? false)
        pending.set(id, { text: e.props.text, isFinal, isPrompt })
      }
    }

    const drawn = await next(e)
    const t = Math.max(await read($, now), first)
    const age = ageLabel(t - first)
    const { Box, Text } = $.ui.resolve(e)

    // Label on its own line below, so the message keeps the full width:
    // tables size themselves to the terminal and break if squeezed. The
    // summary is coloured by its kind of work, still dim so it stays quiet.
    return (
      <Box flexDirection="column">
        {drawn}
        <Box justifyContent="flex-end">
          <Text dimColor>{age}</Text>
          {summary && (
            <Text {...(KIND_COLOR[summary.kind] ? {} : { dimColor: true })} {...colorOf(summary.kind)}>{` · ${summary.words}`}</Text>
          )}
        </Box>
      </Box>
    )
  })

  // `/ages` toggles the panel: open it, or minimize it back to the chat.
  on('command.run', { command: 'ages' }, async ($, e) => {
    const [sub, arg = ''] = (e.args ?? '').trim().split(/\s+/)
    if (sub === 'auto') return { text: await autoCommand($, arg) }
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Ages panel minimized.' }
    }
    await openPanel($, true)
    return { text: 'Ages panel opened. Esc, m, or /ages again minimizes it.' }
  })

  // One row per summarized message, oldest first: the short age, then the
  // summary with no ` · ` separator (the inline labels keep it). Rows with no summary (old ones past BACKFILL_LIMIT, or still
  // waiting) are hidden and counted in one dim line: a resumed session draws its
  // history at once, so they would all show the same age and nothing else.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const all = await read($, labels)
    const list = rows(all, await read($, now))
    const shown = list.filter(row => row.label)
    const hidden = list.length - shown.length

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No messages yet.</Text>}
        {hidden > 0 && (
          <Text dimColor>{`${hidden} earlier message${hidden === 1 ? '' : 's'} (no summary)`}</Text>
        )}
        {shown.map(row => (
          <Box>
            {/* Fixed width, never shrunk: a long summary wraps in its own column. */}
            <Box width={AGE_WIDTH} flexShrink={0}>
              <Text dimColor>{row.age}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text {...(KIND_COLOR[row.label!.kind] ? {} : { dimColor: true })} {...colorOf(row.label!.kind)}>{row.label!.words}</Text>
            </Box>
          </Box>
        ))}
        <Box>
          <Button key="minimize" label="Minimize" hotkey="m" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
