import type { Kind } from '../types'
import { cleanSummary } from './age'

/** Theme colours per kind: they follow the person's light or dark theme. */
export const KIND_COLOR: Record<Kind, string | undefined> = {
  input: 'suggestion', // blue: your prompt
  edit: 'success', // green: changing files
  read: 'merged', // purple: reading, searching, looking things up
  run: 'warning', // amber: commands, tests, builds
  other: undefined, // plain dim: answers, plans, anything else
}

const REPLY_KINDS = ['edit', 'read', 'run', 'other'] as const

/** Splits a reply's "kind: words" answer; an unknown or missing kind is `other`. */
export function parseLabel(raw: string): { kind: Kind; words: string } {
  const [, head = '', rest = ''] = /^\s*["']?([a-z]+)\s*[:\-]\s*(.*)$/is.exec(raw) ?? []
  const kind = REPLY_KINDS.find(k => k === head.toLowerCase())
  return kind ? { kind, words: cleanSummary(rest) } : { kind: 'other', words: cleanSummary(raw) }
}
