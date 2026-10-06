import { test, expect } from 'claude-code/testing'
import { ageLabel, cleanSummary, shortAge } from './age'
import { BACKFILL_LIMIT, pickBackfill } from './store'

test('buckets', () => {
  const cases: [number, string][] = [
    [0, 'just now'], [4_999, 'just now'], [5_000, '5s ago'], [12_000, '10s ago'],
    [45_000, '30s ago'], [61_000, '1m ago'], [150_000, '2m ago'], [299_000, '4m ago'],
    [9 * 60_000, '5m ago'], [15 * 60_000, '10m ago'], [25 * 60_000, '20m ago'],
    [30 * 60_000, '30m ago'], [31 * 60_000, '30m+ ago'],
  ]
  for (const [ms, label] of cases) expect(ageLabel(ms)).toBe(label)
})

test('back-generation picks the newest, up to the limit in total', () => {
  expect(BACKFILL_LIMIT).toBe(20)
  const ids = Array.from({ length: 25 }, (_, i) => `m${i}`)
  const first = pickBackfill(ids, new Set())
  expect(first.length).toBe(20)
  expect(first[0]).toBe('m5')
  expect(first[19]).toBe('m24')
  // A second pick adds nothing once the limit is used up.
  expect(pickBackfill(ids, new Set(first))).toEqual([])
  // Room left is filled from the newest not yet taken.
  expect(pickBackfill(ids, new Set(['m24', 'm23']), 4)).toEqual(['m21', 'm22'])
})

test('summary cleanup', () => {
  expect(cleanSummary('"Fix the Login Bug."\n')).toBe('fix the login bug')
  expect(cleanSummary('one two three four five six seven eight nine ten')).toBe('one two three four five six seven eight')
})

test('panel ages drop "ago"', () => {
  const cases: [number, string][] = [
    [0, 'now'], [5_000, '5s'], [45_000, '30s'], [9 * 60_000, '5m'], [30 * 60_000, '30m'], [31 * 60_000, '30m+'],
  ]
  for (const [ms, label] of cases) expect(shortAge(ms)).toBe(label)
})
