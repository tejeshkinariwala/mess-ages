const STEPS: [number, string][] = [
  [30 * 60, '30m'], [20 * 60, '20m'], [10 * 60, '10m'], [5 * 60, '5m'],
  [4 * 60, '4m'], [3 * 60, '3m'], [2 * 60, '2m'], [60, '1m'],
  [30, '30s'], [10, '10s'], [5, '5s'],
]

export const MAX_SHOWN = 20

export function ageLabel(ms: number): string {
  const s = ms / 1000
  if (s > 30 * 60) return '30m+ ago'
  for (const [limit, text] of STEPS) if (s >= limit) return `${text} ago`
  return 'just now'
}

/** Ids of the newest `MAX_SHOWN` messages, by first-seen time. */
export function newest(seen: Record<string, number>): Set<string> {
  return new Set(
    Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, MAX_SHOWN).map(([id]) => id),
  )
}

/** Keeps at most 8 plain lowercase words. */
export function cleanSummary(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim().split(/\s+/).slice(0, 8).join(' ')
}
