import type { Group, Grouping } from '../types'

// The /ages panel's groups: labelled, contiguous chunks of its rows, written
// by Sonnet. Closed groups are frozen: once made, their rows and subtitle never
// change. Only the last group is open: each pass sends it and the rows after
// it, and the answer may grow it, retitle it, or split it (all but the last
// group of the answer close). Rows after every group sit in a provisional
// "In progress" group until the next pass.

/** A pass runs once this many summarized rows have appeared since the last one. */
export const PASS_EVERY = 5
/** The most rows one pass sends to Sonnet; older ones are grouped without it. */
export const MAX_PASS_ROWS = 30
/** The subtitle of the rows no pass has grouped yet. */
export const IN_PROGRESS = 'In progress'
/** The subtitle of rows a pass grouped without Sonnet, being past MAX_PASS_ROWS. */
export const EARLIER = 'Earlier messages'
/** The longest subtitle kept, in characters. */
const TITLE_MAX = 60

export const GROUP_SYSTEM =
  'You group the rows of a chat log into chunks of work. Each row is "index. age | summary", oldest first. ' +
  'Split the rows into groups of consecutive rows that belong to one piece of work. ' +
  'Give each group a subtitle of 2 to 8 plain words saying what was achieved or is being done. ' +
  'Reply with JSON only, no prose: {"groups":[{"start":0,"end":3,"title":"..."}]}. ' +
  'start and end are row indexes, inclusive. The groups must be in order, cover every row once, and not overlap. ' +
  'Never change, drop or reorder rows.'

export const EMPTY: Grouping = { closed: [], tried: 0, isFlat: false }

export type Range = { start: number; end: number; title: string }

/** One row as sent to Sonnet: its index in the pass, short age and summary. */
export function passPrompt(rows: { age: string; words: string }[]): string {
  return rows.map((row, i) => `${i}. ${row.age} | ${row.words}`).join('\n')
}

/**
 * Reads Sonnet's reply as ranges over `n` rows: contiguous from 0 to n - 1,
 * each with a subtitle. Anything else (no JSON, a gap, an overlap, a row
 * missed, an empty title) is undefined.
 */
export function parseGroups(text: string, n: number): Range[] | undefined {
  if (n <= 0) return undefined
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')
  if (from < 0 || to < from) return undefined
  let json: unknown
  try {
    json = JSON.parse(text.slice(from, to + 1))
  } catch {
    return undefined
  }
  const groups = (json as { groups?: unknown })?.groups
  if (!Array.isArray(groups) || groups.length === 0) return undefined
  const ranges: Range[] = []
  let next = 0
  for (const g of groups) {
    const { start, end, title } = (g ?? {}) as Record<string, unknown>
    if (!Number.isInteger(start) || !Number.isInteger(end) || typeof title !== 'string') return undefined
    if (start !== next || (end as number) < (start as number) || (end as number) >= n) return undefined
    const clean = title.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
    if (!clean) return undefined
    ranges.push({ start: start as number, end: end as number, title: clean })
    next = (end as number) + 1
  }
  return next === n ? ranges : undefined
}

/** Every row id the grouping holds, oldest first. */
export function groupedIds(grouping: Grouping): string[] {
  return [...grouping.closed, ...(grouping.open ? [grouping.open] : [])].flatMap(g => g.ids)
}

/**
 * True when the grouping still fits the rows shown: its ids, in order, are
 * the first of `shown`. A reload can redraw rows in another order; then it
 * does not, and the panel draws the flat list.
 */
export function fits(grouping: Grouping, shown: string[]): boolean {
  const ids = groupedIds(grouping)
  return ids.length <= shown.length && ids.every((id, i) => shown[i] === id)
}

/**
 * Whether a pass should run now: when the panel opens (`isOpening`) and any
 * row has appeared since the last pass, or at least PASS_EVERY have.
 */
export function shouldPass(grouping: Grouping, shownCount: number, isOpening: boolean): boolean {
  const fresh = shownCount - grouping.tried
  return isOpening ? fresh > 0 : fresh >= PASS_EVERY
}

export type Plan = {
  /** Closed groups made without Sonnet, appended after the current closed ones. */
  frozen: Group[]
  /** The rows Sonnet groups this pass, oldest first: at most `cap`. */
  work: string[]
}

/**
 * What a pass sends: the open group and the rows after it. Past `cap`, the
 * open group closes as it stands and only the new rows are sent; still past
 * it, the oldest new rows close in one EARLIER group and the newest `cap` go.
 */
export function planPass(grouping: Grouping, shown: string[], cap = MAX_PASS_ROWS): Plan {
  const fresh = shown.slice(groupedIds(grouping).length)
  const open = grouping.open
  const frozen: Group[] = []
  let work = [...(open?.ids ?? []), ...fresh]
  if (work.length > cap && open) {
    frozen.push(open)
    work = fresh
  }
  if (work.length > cap) {
    frozen.push({ ids: work.slice(0, work.length - cap), title: EARLIER })
    work = work.slice(-cap)
  }
  return { frozen, work }
}

/**
 * The grouping after a pass Sonnet answered with `ranges` over `plan.work`:
 * the closed groups kept as they are, the plan's frozen ones and all but the
 * last range closed after them, the last range the open group.
 */
export function applyPass(grouping: Grouping, plan: Plan, ranges: Range[], shownCount: number): Grouping {
  const made = ranges.map(r => ({ ids: plan.work.slice(r.start, r.end + 1), title: r.title }))
  return {
    closed: [...grouping.closed, ...plan.frozen, ...made.slice(0, -1)],
    open: made[made.length - 1],
    tried: shownCount,
    isFlat: false,
  }
}

/** A failed pass: the groups kept, the panel flat until a pass succeeds. */
export function failPass(grouping: Grouping, shownCount: number): Grouping {
  return { ...grouping, tried: shownCount, isFlat: true }
}

export type Section = {
  /** The fold key: the first row's id, or IN_PROGRESS for the provisional group. */
  key: string
  title: string
  ids: string[]
  status: 'closed' | 'open' | 'provisional'
}

/**
 * The panel's sections over the rows shown, oldest first: the closed groups,
 * the open one, then the provisional group of the rest. Undefined draws the
 * flat list: no grouping yet, a failed pass, or one that no longer fits.
 */
export function sections(grouping: Grouping, shown: string[]): Section[] | undefined {
  if (grouping.isFlat || (!grouping.closed.length && !grouping.open) || !fits(grouping, shown)) return undefined
  const out: Section[] = grouping.closed.map(g => ({ key: g.ids[0]!, title: g.title, ids: g.ids, status: 'closed' as const }))
  if (grouping.open) out.push({ key: grouping.open.ids[0]!, title: grouping.open.title, ids: grouping.open.ids, status: 'open' })
  const rest = shown.slice(groupedIds(grouping).length)
  if (rest.length) out.push({ key: IN_PROGRESS, title: IN_PROGRESS, ids: rest, status: 'provisional' })
  return out
}

/** Whether a section is folded: the person's choice, else closed groups start folded. */
export function isCollapsed(section: Section, folds: Record<string, boolean>): boolean {
  return folds[section.key] ?? section.status === 'closed'
}

/** The header the cursor moves to from `cursor` by `by` (-1 up, 1 down), or undefined past an end. */
export function moveCursor(keys: string[], cursor: string | undefined, by: number): string | undefined {
  if (!keys.length) return undefined
  const at = cursor === undefined ? -1 : keys.indexOf(cursor)
  if (at < 0) return keys[keys.length - 1] // no cursor yet: the newest group, which is in view
  return keys[at + Math.sign(by)]
}
