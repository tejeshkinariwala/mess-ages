import type { Kind } from '../types'
import { cleanSummary } from './age'
import { HARD_WORDS, SOFT_WORDS } from './style'

// The label vocabulary: the leading word of each `verb: detail` segment.
// SEED_VERBS ship with the plugin; the person's own list lives outside the
// repo at ~/.claude/mess-ages/verbs.json and grows as labels use new verbs.

/** The verbs the plugin ships with, each with the colour group it draws in. */
export const SEED_VERBS: Readonly<Record<string, Kind>> = {
  // The old kinds.
  input: 'input', edit: 'edit', read: 'read', run: 'run', other: 'other',
  // The old status prefixes.
  plan: 'other', done: 'other', ask: 'other', wait: 'other', fail: 'other',
  // Common actions.
  fix: 'edit', add: 'edit', remove: 'edit', write: 'edit', delete: 'edit',
  check: 'read', review: 'read', search: 'read',
  test: 'run', push: 'run', merge: 'run', build: 'run',
  explain: 'other', decide: 'other', report: 'other',
}

/** The most verbs suggested to the model. */
export const VOCAB_CAP = 30
/** Uses after which a learned verb is promoted into the suggestions. */
export const PROMOTE_AT = 2
/** Where the person's list lives, under HOME. */
export const VERBS_FILE = '.claude/mess-ages/verbs.json'

/** The person's list: use counts, promoted verbs, and verbs never to learn or suggest. */
export type VerbFile = { learned: Record<string, number>; promoted: string[]; removed: string[] }

export const emptyVerbFile = (): VerbFile => ({ learned: {}, promoted: [], removed: [] })

/** A verb is one lowercase word of 2 to 12 letters. */
export const isVerb = (v: unknown): v is string => typeof v === 'string' && /^[a-z]{2,12}$/.test(v)

const isSeed = (v: string) => Object.prototype.hasOwnProperty.call(SEED_VERBS, v)

/** The colour group of a verb: its seed group, else `other`. */
export function verbGroup(verb: string | undefined): Kind {
  return verb !== undefined && isSeed(verb) ? SEED_VERBS[verb]! : 'other'
}

/** Reads the file's text; anything missing, corrupt or of the wrong shape is dropped, never thrown. */
export function parseVerbFile(text: string | undefined): VerbFile {
  let json: unknown
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = undefined
  }
  const o = (json && typeof json === 'object' && !Array.isArray(json) ? json : {}) as Record<string, unknown>
  const learned: Record<string, number> = {}
  if (o.learned && typeof o.learned === 'object' && !Array.isArray(o.learned)) {
    for (const [v, n] of Object.entries(o.learned as Record<string, unknown>)) {
      if (isVerb(v) && typeof n === 'number' && Number.isFinite(n) && n > 0) learned[v] = Math.floor(n)
    }
  }
  const list = (x: unknown) => (Array.isArray(x) ? [...new Set(x.filter(isVerb))] : [])
  const removed = list(o.removed)
  const promoted = list(o.promoted).filter(v => !removed.includes(v) && !isSeed(v))
  return { learned, promoted, removed }
}

export function serializeVerbFile(file: VerbFile): string {
  return JSON.stringify(file, null, 2) + '\n'
}

/**
 * Counts each verb a label used. A verb in `removed` or not a single
 * lowercase word is ignored; a new verb that reaches PROMOTE_AT uses is
 * promoted. Seed verbs are counted too (for `/ages verbs`), never promoted.
 * Returns the same object when nothing changed.
 */
export function learn(file: VerbFile, verbs: readonly (string | undefined)[]): VerbFile {
  const used = [...new Set(verbs.filter(isVerb))].filter(v => !file.removed.includes(v))
  if (!used.length) return file
  const learned = { ...file.learned }
  const promoted = [...file.promoted]
  for (const v of used) {
    learned[v] = (learned[v] ?? 0) + 1
    if (!isSeed(v) && !promoted.includes(v) && learned[v]! >= PROMOTE_AT) promoted.push(v)
  }
  return { learned, promoted, removed: file.removed }
}

/** The verbs suggested to the model: seed first, then promoted by use count, at most `cap`. */
export function vocabulary(file: VerbFile, cap = VOCAB_CAP): string[] {
  const seed = Object.keys(SEED_VERBS).filter(v => !file.removed.includes(v))
  const promoted = file.promoted
    .filter(v => !file.removed.includes(v) && !isSeed(v))
    .sort((a, b) => (file.learned[b] ?? 0) - (file.learned[a] ?? 0) || a.localeCompare(b))
  return [...seed, ...promoted].slice(0, cap)
}

/** The prompt text naming the vocabulary and the label format; shared by all three prompts. */
export function vocabRules(vocab: readonly string[]): string {
  return 'Format: one or more "verb: detail" segments joined by " | ". ' +
    'verb is one lowercase word followed by ": "; detail is the plain words after it, never empty. ' +
    `Prefer these verbs: ${vocab.join(', ')}. ` +
    'Use a new single lowercase verb only if none of these fits. ' +
    'One segment is best. Add a second segment only for a separate step or state. Never a third segment.'
}

// --- Parsing --------------------------------------------------------------

/** One `verb: detail` part of a label; `verb` is absent for an old label of plain words. */
export type Segment = { verb?: string; detail: string }

const SEGMENT = /^([a-z]{2,12}):(?:\s+(.*))?$/s
const isMark = (t: string) => /^[&|:]+$/.test(t)

/**
 * Splits a label on ` | ` into segments. A segment is `verb: detail` (one
 * lowercase word, colon, space, the rest), or detail alone when it has no
 * verb (old labels, plain words). A verb with no detail keeps its word as
 * detail. Empty segments are dropped. Old double prefixes such as
 * `edit: done: x` read as verb `edit`, detail `done: x`.
 */
export function parseSegments(text: string): Segment[] {
  const out: Segment[] = []
  for (const part of text.split('|')) {
    const s = part.trim()
    if (!s) continue
    const m = SEGMENT.exec(s)
    if (m && m[2]?.trim()) out.push({ verb: m[1]!, detail: m[2].trim() })
    else if (m) out.push({ detail: m[1]! })
    else out.push({ detail: s })
  }
  return out
}

/** Joins segments back into one label. */
export function formatSegments(segments: readonly Segment[]): string {
  return segments.map(s => (s.verb ? `${s.verb}: ${s.detail}` : s.detail)).join(' | ')
}

// Word counting, the same for summaries and group subtitles: a verb prefix
// (`edit:`, or `Wait:` in a subtitle) counts as one word, like each word after
// it; the marks `&`, `|` and `:` standing alone are not words.
const tokensOf = (s: Segment) => s.detail.split(/\s+/).filter(Boolean)

/** A segment's word count, its verb counted as one word. */
export function segmentWords(s: Segment): number {
  return (s.verb ? 1 : 0) + tokensOf(s).filter(t => !isMark(t)).length
}

/** A label's word count across all its segments. */
export const labelWords = (segments: readonly Segment[]) => segments.reduce((n, s) => n + segmentWords(s), 0)

/** The segment cut to its first `max` words (verb counted), no trailing mark; undefined if nothing is left. */
function cutSegment(s: Segment, max: number): Segment | undefined {
  let left = s.verb ? max - 1 : max
  const kept: string[] = []
  for (const t of tokensOf(s)) {
    if (!isMark(t)) {
      if (left <= 0) break
      left--
    }
    kept.push(t)
  }
  while (kept.length && isMark(kept.at(-1)!)) kept.pop()
  return kept.length ? { ...(s.verb ? { verb: s.verb } : {}), detail: kept.join(' ') } : undefined
}

/**
 * The one length limit for summaries and group subtitles (SOFT_WORDS 8,
 * HARD_WORDS 16, in style.ts):
 * - several segments within HARD_WORDS in all are kept whole;
 * - past HARD_WORDS, trailing segments are dropped whole at ` | ` until the
 *   rest fits, so no phrase is cut and no bare verb is left;
 * - a single segment past SOFT_WORDS, from the model or left after the drop
 *   (even one past HARD_WORDS alone), is cut to its first SOFT_WORDS words.
 */
export function fitSegments(segments: readonly Segment[]): Segment[] {
  const out = [...segments]
  while (out.length > 1 && labelWords(out) > HARD_WORDS) out.pop()
  if (out.length === 1 && segmentWords(out[0]!) > SOFT_WORDS) {
    const cut = cutSegment(out[0]!, SOFT_WORDS)
    return cut ? [cut] : []
  }
  return out
}

/** A plain-text label (a group subtitle) fitted the same way as a summary. */
export function fitLabel(text: string): string {
  return formatSegments(fitSegments(parseSegments(text)))
}

/** A model's raw label, cleaned: lowercase, "and" as "&", a literal `kind:` dropped, fitted to the length limits. */
export function normalizeLabel(raw: string): Segment[] {
  const text = raw
    .replace(/^\s*["']?\s*kind\s*:\s*(?=[a-z]+\s*:)/i, '')
    // An old "Read - look at x": a seed verb and a dash reads as "read: look at x".
    .replace(/^\s*["']?([a-z]{2,12})\s+-\s+/i, (all, v: string) => (isSeed(v.toLowerCase()) ? `${v}: ` : all))
  // cleanSummary's own cut is generous here; the segment cut is the real one.
  const clean = cleanSummary(text, 64).replace(/(^|\|\s*)([a-z]{2,12})\s*:(?=\S)/g, '$1$2: ')
  return fitSegments(parseSegments(clean))
}

// --- /ages verbs -------------------------------------------------------------

const withCount = (file: VerbFile, v: string) => `${v} (${file.learned[v] ?? 0})`

/** What `/ages verbs` prints: suggested verbs with use counts, then pending and removed ones. */
export function listVerbs(file: VerbFile, path: string): string {
  const vocab = vocabulary(file)
  const seed = Object.keys(SEED_VERBS).filter(v => !file.removed.includes(v))
  const promoted = vocab.filter(v => !isSeed(v))
  const pending = Object.keys(file.learned)
    .filter(v => !isSeed(v) && !file.promoted.includes(v) && !file.removed.includes(v))
    .sort((a, b) => file.learned[b]! - file.learned[a]! || a.localeCompare(b))
  const lines = [
    `Label verbs suggested to the model (${vocab.length}/${VOCAB_CAP}), with use counts:`,
    `seed: ${seed.map(v => withCount(file, v)).join(', ') || 'none'}`,
    `learned: ${promoted.map(v => withCount(file, v)).join(', ') || 'none yet'}`,
  ]
  const unshown = file.promoted.filter(v => !vocab.includes(v) && !file.removed.includes(v))
  if (unshown.length) lines.push(`learned, past the cap of ${VOCAB_CAP}: ${unshown.map(v => withCount(file, v)).join(', ')}`)
  if (pending.length) lines.push(`pending: ${pending.map(v => `${v} ${file.learned[v]}/${PROMOTE_AT}`).join(', ')}`)
  if (file.removed.length) lines.push(`removed: ${file.removed.join(', ')}`)
  lines.push(`File: ${path}. /ages verbs remove <verb> hides one; /ages verbs reset clears the list.`)
  return lines.join('\n')
}

/** Adds `verb` to `removed` and drops it from the counts and the promoted list. */
export function removeVerb(file: VerbFile, verb: string): VerbFile {
  const learned = { ...file.learned }
  delete learned[verb]
  return {
    learned,
    promoted: file.promoted.filter(v => v !== verb),
    removed: file.removed.includes(verb) ? file.removed : [...file.removed, verb],
  }
}

/**
 * Answers `/ages verbs [remove <verb> | reset]` (args after `verbs`): the
 * text to show, the list after it, and whether that needs writing.
 */
export function verbsCommand(file: VerbFile, args: readonly string[], path: string):
  { file: VerbFile; text: string; changed: boolean } {
  const [sub = '', arg = ''] = args.map(a => a.toLowerCase())
  if (sub === '' || sub === 'list') return { file, text: listVerbs(file, path), changed: false }
  if (sub === 'reset') {
    return { file: emptyVerbFile(), text: 'Verb list cleared: learned, promoted and removed verbs are empty again.', changed: true }
  }
  if (sub === 'remove') {
    if (!isVerb(arg)) return { file, text: 'Usage: /ages verbs remove <verb> (one lowercase word, 2 to 12 letters).', changed: false }
    const next = removeVerb(file, arg)
    const note = isSeed(arg)
      ? `"${arg}" is a seed verb: it is now hidden from the suggestions and never counted, but labels that use it still parse and colour.`
      : `"${arg}" removed: it is never learned or suggested again.`
    return { file: next, text: `${note} /ages verbs reset undoes all removals.`, changed: true }
  }
  return { file, text: 'Usage: /ages verbs, /ages verbs remove <verb>, /ages verbs reset.', changed: false }
}
