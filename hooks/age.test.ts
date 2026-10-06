import { test, expect } from 'claude-code/testing'
import { ageLabel, newest } from './age'

test('buckets', () => {
  const cases: [number, string][] = [
    [0, 'just now'], [4_999, 'just now'], [5_000, '5s ago'], [12_000, '10s ago'],
    [45_000, '30s ago'], [61_000, '1m ago'], [150_000, '2m ago'], [299_000, '4m ago'],
    [9 * 60_000, '5m ago'], [15 * 60_000, '10m ago'], [25 * 60_000, '20m ago'],
    [30 * 60_000, '30m ago'], [31 * 60_000, '30m+ ago'],
  ]
  for (const [ms, label] of cases) expect(ageLabel(ms)).toBe(label)
})

test('only newest 20', () => {
  const seen: Record<string, number> = {}
  for (let i = 0; i < 25; i++) seen[`m${i}`] = i
  const ids = newest(seen)
  expect(ids.size).toBe(20)
  expect(ids.has('m24')).toBe(true)
  expect(ids.has('m4')).toBe(false)
})

import { cleanSummary } from './age'

test('summary cleanup', () => {
  expect(cleanSummary('"Fix the Login Bug."\n')).toBe('fix the login bug')
  expect(cleanSummary('one two three four five six seven eight nine ten')).toBe('one two three four five six seven eight')
})
