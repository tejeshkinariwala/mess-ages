import type { Label, Labels, SeenMap } from '../types'
import { shortAge } from './age'

// What the inline labels and the panel both read: first-seen times here, in
// module memory (render hooks may not write $.state), and the labels in the
// `labels` atom, which register.tsx declares (the validator reads atoms only
// in the file that writes them) and hands to `rows`.

/**
 * How many old messages (drawn before this session's first prompt, as in a
 * resumed session, and with no summary yet) get a summary when `/ages` opens:
 * the newest this many. Older ones keep the age label alone. Live messages
 * have no limit.
 */
export const BACKFILL_LIMIT = 20

// Every message drawn this load, by id, in the order first drawn. Not capped:
// every message gets a label, and the panel lists the whole session.
export const seen: SeenMap = {}

export type Row = { id: string; age: string; label?: Label }

/** Records when a message was first drawn; later draws keep the first time. */
export function markSeen(id: string, t: number): number {
  if (seen[id] === undefined) seen[id] = t
  return seen[id]
}

/** One row per message seen, oldest first: its short age at `t` and its label if any. */
export function rows(all: Labels, t: number): Row[] {
  return Object.entries(seen).map(([id, at]) => ({ id, age: shortAge(Math.max(t, at) - at), label: all[id] }))
}

/**
 * The old messages to summarize now: the newest of `candidates` (oldest
 * first) not yet `taken`, so that `taken` plus these stays within `limit`.
 */
export function pickBackfill(candidates: string[], taken: ReadonlySet<string>, limit = BACKFILL_LIMIT): string[] {
  const room = Math.max(0, limit - taken.size)
  if (room === 0) return []
  return candidates.filter(id => !taken.has(id)).slice(-room)
}

/** Empties the store's module memory: a fresh load starts with none seen. */
export function resetSeen() {
  for (const id of Object.keys(seen)) delete seen[id]
}
