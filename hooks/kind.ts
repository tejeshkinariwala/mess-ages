import type { Kind } from '../types'
import { formatSegments, normalizeLabel, verbGroup } from './verbs'
import type { Segment } from './verbs'

/** Theme colours per kind: they follow the person's light or dark theme. */
export const KIND_COLOR: Record<Kind, string | undefined> = {
  input: 'suggestion', // blue: your prompt
  edit: 'success', // green: changing files
  read: 'merged', // purple: reading, searching, looking things up
  run: 'warning', // amber: commands, tests, builds
  other: undefined, // plain dim: answers, plans, anything else
}

/**
 * Reads a model's label: `verb: detail` segments joined by ` | `, old forms
 * too (`edit: done: x`, plain words, `kind: run: x`). The first segment's
 * verb picks the colour group (unknown or none: `other`); a prompt's label is
 * always `input`. `words` is the cleaned label, verbs kept; `segments` its parts.
 */
export function parseLabel(raw: string, isPrompt = false): { kind: Kind; words: string; segments: Segment[] } {
  const segments = normalizeLabel(raw)
  const kind: Kind = isPrompt ? 'input' : verbGroup(segments[0]?.verb)
  return { kind, words: formatSegments(segments), segments }
}
