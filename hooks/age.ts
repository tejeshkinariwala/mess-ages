const STEPS: [number, string][] = [
  [30 * 60, '30m'], [20 * 60, '20m'], [10 * 60, '10m'], [5 * 60, '5m'],
  [4 * 60, '4m'], [3 * 60, '3m'], [2 * 60, '2m'], [60, '1m'],
  [30, '30s'], [10, '10s'], [5, '5s'],
]

export function ageLabel(ms: number): string {
  const s = ms / 1000
  if (s > 30 * 60) return '30m+ ago'
  for (const [limit, text] of STEPS) if (s >= limit) return `${text} ago`
  return 'just now'
}

/** Keeps at most 8 plain lowercase words. */
export function cleanSummary(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim().split(/\s+/).slice(0, 8).join(' ')
}
