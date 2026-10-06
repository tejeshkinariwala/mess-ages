import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Folds, Kind, Label, Labels } from '../types'
import { ageLabel } from './age'
import {
  EMPTY, applyPass, failPass, fits, isCollapsed, moveCursor, parseGroups, passPrompt, planPass,
  groupSystem, sections, shouldPass,
} from './groups'
import { KIND_COLOR, parseLabel } from './kind'
import { labelPrompt, promptSystem, replySystem } from './prompts'
import { markSeen, pickBackfill, resetSeen, rows, seen } from './store'
import type { Row } from './store'
import {
  VERBS_FILE, emptyVerbFile, learn, parseSegments, parseVerbFile, serializeVerbFile, verbGroup, verbsCommand,
  vocabulary,
} from './verbs'
import type { VerbFile } from './verbs'

const now = atom({ plugin: 'mess-ages', key: 'now' } as const, 0)
const labels = atom({ plugin: 'mess-ages', key: 'labels' } as const, {} as Labels)
const groups = atom({ plugin: 'mess-ages', key: 'groups' } as const, EMPTY)
const folds = atom({ plugin: 'mess-ages', key: 'folds' } as const, {} as Folds)

// The side panel listing every message's age and summary, opened by /ages.
const PANE = 'ages'
// While this hidden file exists, the panel opens at the start of each session.
const AUTO_FLAG = '.claude/.mess-ages-always'
// The panel's age column: wide enough for the longest short age, `30m+`, plus a space.
const AGE_WIDTH = 5

// The label prompts live in prompts.ts and groups.ts; each names the
// current verb vocabulary (verbs.ts).

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
// One grouping pass at a time; the header holding the panel's focus ring.
let isGrouping = false
let cursor: string | undefined

// `other` keeps the plain dim colour: no color prop at all.
function colorOf(kind: Kind) {
  const color = KIND_COLOR[kind]
  return color ? { color } : { dimColor: true }
}

// The person's verb list (~/.claude/mess-ages/verbs.json): read once per
// load, then kept in memory and written back after each label that used a
// verb. Any failure reads as an empty list and is never thrown.
let verbLoad: Promise<VerbFile> | undefined
let verbFile: VerbFile | undefined

async function verbsPath($: EngineInterface) {
  const home = await $.env.get('HOME').catch(() => undefined)
  return home ? `${home}/${VERBS_FILE}` : undefined
}

async function loadVerbs($: EngineInterface): Promise<VerbFile> {
  if (verbFile) return verbFile
  verbLoad ??= (async () => {
    const path = await verbsPath($)
    const text = path ? await $.fs.read(path).catch(() => undefined) : undefined
    return parseVerbFile(typeof text === 'string' ? text : undefined)
  })().catch(() => emptyVerbFile())
  verbFile ??= await verbLoad
  return verbFile
}

async function saveVerbs($: EngineInterface, file: VerbFile) {
  verbFile = file
  const path = await verbsPath($)
  if (!path) return
  await $.fs.write(path, serializeVerbFile(file))
    .catch(err => $.ui.log(`mess-ages: verbs not saved: ${err}`, { to: 'debug' }))
}

// A label's text: a single segment (or old plain words) in its kind's colour
// as before; several segments with each verb in its own group's colour (a
// prompt's verbs all blue) and the details dim.
function labelText(Text: any, label: Label, lead: string) {
  const segments = parseSegments(label.words)
  if (segments.length <= 1) return <Text {...colorOf(label.kind)}>{`${lead}${label.words}`}</Text>
  const verbColor = (verb: string) => colorOf(label.kind === 'input' ? 'input' : verbGroup(verb))
  return (
    <Text>
      {lead && <Text dimColor>{lead}</Text>}
      {segments.flatMap((s, i) => [
        ...(i ? [<Text dimColor>{' | '}</Text>] : []),
        ...(s.verb ? [<Text {...verbColor(s.verb)}>{`${s.verb}: `}</Text>] : []),
        <Text dimColor>{s.detail}</Text>,
      ])}
    </Text>
  )
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
      const vocab = vocabulary(await loadVerbs($))
      const r = await $.model.complete({
        model: 'sonnet', effort: 'low', system: isPrompt ? promptSystem(vocab) : replySystem(vocab),
        prompt: labelPrompt(text.slice(0, 4000)), maxTokens: 60, // room for a 16-word label
      })
      if (!r.isAnswered) continue
      const { kind, words, segments } = parseLabel(r.text, isPrompt)
      if (!words) continue
      // Kept for every message: the panel lists the whole session.
      await update($, labels, m => ({ ...m, [id]: { kind, words } }))
      // Each verb it used counts; a new one used twice joins the suggestions.
      const file = await loadVerbs($)
      const learned = learn(file, segments.map(s => s.verb))
      if (learned !== file) await saveVerbs($, learned)
    }
  } finally {
    isBusy = false
  }
}

// The ids of the panel's rows with a summary, oldest first.
async function shownIds($: EngineInterface) {
  return rows(await read($, labels), 0).filter(row => row.label).map(row => row.id)
}

async function isPanelOpen($: EngineInterface) {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

// Groups the panel's rows: when it opens (`isOpening`), and after PASS_EVERY
// new summarized rows while it is open. One Sonnet call sends the open group
// and the rows after it, never the closed ones; any failure leaves the panel
// flat until a later pass succeeds.
async function groupPass($: EngineInterface, isOpening: boolean) {
  if (isGrouping) return
  isGrouping = true
  try {
    const shown = await shownIds($)
    let grouping = await read($, groups)
    if (!fits(grouping, shown)) grouping = EMPTY // rows redrawn in another order: start over
    if (!shouldPass(grouping, shown.length, isOpening)) return
    const plan = planPass(grouping, shown)
    const all = await read($, labels)
    const t = await read($, now)
    const byId = new Map(rows(all, t).map(row => [row.id, row]))
    const r = await $.model.complete({
      model: 'sonnet', effort: 'low', system: groupSystem(vocabulary(await loadVerbs($))), maxTokens: 600,
      prompt: passPrompt(plan.work.map(id => ({ age: byId.get(id)!.age, words: all[id]!.words }))),
    }).catch(() => undefined)
    const ranges = r?.isAnswered ? parseGroups(r.text, plan.work.length) : undefined
    if (!ranges) $.ui.log('mess-ages: grouping failed; the panel stays flat', { to: 'debug' })
    await update($, groups, () => ranges ? applyPass(grouping, plan, ranges, shown.length) : failPass(grouping, shown.length))
  } finally {
    isGrouping = false
  }
}

// The group header an arrow moves the cursor to, or undefined to scroll.
async function headerTo($: EngineInterface, by: number) {
  const parts = sections(await read($, groups), await shownIds($))
  return parts && moveCursor(parts.map(p => `group:${p.key}`), cursor, by)
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
  // Focused so the arrows move between groups and scroll; Escape hands the keys back and closes it.
  const opened = await $.ui.open({ id: PANE, title: 'Ages', closeOnEscape: true, ...(focus ? { focus: true } : {}) })
  if (opened.isPlaced) void $.ui.scroll({ in: PANE, to: 'end' }).catch(() => {}) // newest in view
  void groupPass($, true).catch(err => $.ui.log(`mess-ages: grouping failed: ${err}`, { to: 'debug' }))
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

// `/ages verbs [remove <verb> | reset]`: lists, hides or clears the person's verbs.
async function verbsCommand$($: EngineInterface, args: string[]) {
  const { file, text, changed } = verbsCommand(await loadVerbs($), args, (await verbsPath($)) ?? `~/${VERBS_FILE}`)
  if (changed) await saveVerbs($, file)
  return text
}

export const register: Register = on => {
  // A fresh load starts with nothing seen and nothing live, and reads the verb list again.
  verbLoad = undefined
  verbFile = undefined
  resetSeen()
  for (const c of [pending, asked, oldIds, old, backfilled]) c.clear()
  isLive = false
  isTurnRunning = false
  isGrouping = false
  cursor = undefined
  on('session.start', async ($, e, next) => {
    const t = await $.clock.now()
    await update($, now, () => t)
    // A failed registration costs the panel alone, never the labels.
    await $.command.register({
      name: 'ages',
      description: 'Toggle a side panel listing every message\'s age and summary; /ages auto on|off opens it each session; /ages verbs lists label verbs',
    }).catch(err => $.ui.log(`mess-ages: /ages not registered: ${err}`, { to: 'debug' }))
    // The one timer for every label, however many: every 5s it moves `now`, so
    // renders that read it redraw when a label can change, and it drains the
    // queued texts outside of drawing.
    $.clock.every(5000, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
      void summarizeQueue($)
      if (await isPanelOpen($).catch(() => false)) void groupPass($, false).catch(() => {})
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
          {summary && labelText(Text, summary, ' · ')}
        </Box>
      </Box>
    )
  })

  // `/ages` toggles the panel: open it, or minimize it back to the chat.
  on('command.run', { command: 'ages' }, async ($, e) => {
    const [sub, arg = '', ...rest] = (e.args ?? '').trim().split(/\s+/)
    if (sub === 'auto') return { text: await autoCommand($, arg) }
    if (sub === 'verbs') return { text: await verbsCommand$($, [arg, ...rest].filter(Boolean)) }
    if (await isPanelOpen($)) {
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
  // Once a pass has grouped them, the rows sit under foldable group headers;
  // with no grouping, or a failed one, the flat list.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const all = await read($, labels)
    const list = rows(all, await read($, now))
    const shown = list.filter(row => row.label)
    const hidden = list.length - shown.length
    const parts = sections(await read($, groups), shown.map(row => row.id))
    const folded = await read($, folds)
    const byId = new Map(shown.map(row => [row.id, row]))

    const drawRow = (row: Row) => (
      <Box>
        {/* Fixed width, never shrunk: a long summary wraps in its own column. */}
        <Box width={AGE_WIDTH} flexShrink={0}>
          <Text dimColor>{row.age}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          {labelText(Text, row.label!, '')}
        </Box>
      </Box>
    )
    // Fold choices are written from the press, never while drawing.
    const setFolds = (fn: (m: Folds) => Folds) => update($, folds, fn)

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No messages yet.</Text>}
        {hidden > 0 && (
          <Text dimColor>{`${hidden} earlier message${hidden === 1 ? '' : 's'} (no summary)`}</Text>
        )}
        {parts
          ? parts.map(part => {
            const isFolded = isCollapsed(part, folded)
            return (
              <Box flexDirection="column">
                {/* The header: Enter on it (the focus ring is the cursor) folds or unfolds it. */}
                <Button
                  key={`group:${part.key}`} plain
                  label={`${isFolded ? '▸' : '▾'} ${part.title} (${part.ids.length})`}
                  onPress={() => setFolds(m => ({ ...m, [part.key]: !isCollapsed(part, m) }))}
                />
                {!isFolded && part.ids.map(id => drawRow(byId.get(id)!))}
              </Box>
            )
          })
          : shown.map(drawRow)}
        <Box>
          <Button key="minimize" label="Minimize" hotkey="m" onPress={() => $.ui.close({ id: PANE })} />
          {parts && (
            <Button key="collapse" label="Collapse all" hotkey="c"
              onPress={() => setFolds(m => ({ ...m, ...Object.fromEntries(parts.map(p => [p.key, true])) }))} />
          )}
          {parts && (
            <Button key="expand" label="Expand all" hotkey="e"
              onPress={() => setFolds(m => ({ ...m, ...Object.fromEntries(parts.map(p => [p.key, false])) }))} />
          )}
        </Box>
      </Box>
    )
  })

  // The focus ring on a group header is the panel's cursor: remember which.
  on('ui.focus', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    cursor = e.element?.startsWith('group:') ? e.element : undefined
    return next(e)
  })

  // Up and Down move the cursor between group headers. Past the first or last
  // header, with no groups, and for the wheel and page keys, the panel scrolls
  // as before.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || e.pointer || Math.abs(e.by) !== 1) return next(e)
    const to = await headerTo($, e.by).catch(() => undefined)
    if (!to) return next(e)
    const moved = await $.ui.focus({ requestId: PANE, key: to }).catch(() => ({ deny: 'failed' }))
    if (moved.deny) return next(e)
    void $.ui.scroll({ in: PANE, to: { key: to } }).catch(() => {}) // the header in view
    return {}
  })
}
