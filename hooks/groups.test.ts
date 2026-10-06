import { test, expect } from 'claude-code/testing'

import {
  EARLIER, EMPTY, IN_PROGRESS, MAX_PASS_ROWS, PASS_EVERY, applyPass, failPass, isCollapsed, moveCursor, parseGroups,
  planPass, sections, shouldPass,
} from './groups'

const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `m${from + i}`)
const reply = (...groups: [number, number, string][]) =>
  JSON.stringify({ groups: groups.map(([start, end, title]) => ({ start, end, title })) })

test('parseGroups keeps contiguous, covering ranges and refuses anything else', () => {
  expect(parseGroups(reply([0, 1, 'a'], [2, 4, 'b']), 5)).toEqual([
    { start: 0, end: 1, title: 'a' }, { start: 2, end: 4, title: 'b' },
  ])
  // Prose or a code fence around the JSON is fine.
  expect(parseGroups('```json\n' + reply([0, 2, 'all']) + '\n```', 3)?.length).toBe(1)
  expect(parseGroups('no json here', 3)).toBeUndefined()
  expect(parseGroups('{"groups": [', 3)).toBeUndefined() // cut off
  expect(parseGroups('{"groups": []}', 3)).toBeUndefined()
  expect(parseGroups(reply([0, 1, 'a'], [3, 4, 'b']), 5)).toBeUndefined() // a gap
  expect(parseGroups(reply([0, 2, 'a'], [2, 4, 'b']), 5)).toBeUndefined() // an overlap
  expect(parseGroups(reply([0, 3, 'a']), 5)).toBeUndefined() // a row missed
  expect(parseGroups(reply([0, 5, 'a']), 5)).toBeUndefined() // past the end
  expect(parseGroups(reply([1, 4, 'a']), 5)).toBeUndefined() // not from 0
  expect(parseGroups(reply([2, 1, 'a']), 3)).toBeUndefined() // backwards
  expect(parseGroups(reply([0, 2, '   ']), 3)).toBeUndefined() // no title
  expect(parseGroups('{"groups":[{"start":"0","end":2,"title":"a"}]}', 3)).toBeUndefined()
  expect(parseGroups(reply([0, 0, 'x'.repeat(200)]), 1)?.[0]?.title.length).toBe(60)
})

test('the first pass groups every row; the last group is open', () => {
  const shown = ids(6)
  const plan = planPass(EMPTY, shown)
  expect(plan).toEqual({ frozen: [], work: shown })
  const g = applyPass(EMPTY, plan, parseGroups(reply([0, 2, 'a'], [3, 5, 'b']), 6)!, 6)
  expect(g.closed).toEqual([{ ids: ids(3), title: 'a' }])
  expect(g.open).toEqual({ ids: ids(3, 3), title: 'b' })
  expect(g.tried).toBe(6)
})

test('later passes send only the open group and new rows; closed groups stay frozen', () => {
  const first = applyPass(EMPTY, planPass(EMPTY, ids(6)), parseGroups(reply([0, 2, 'a'], [3, 5, 'b']), 6)!, 6)
  const frozen = JSON.stringify(first.closed)

  // Absorb: the open group takes the new rows and a new subtitle.
  const plan = planPass(first, ids(9))
  expect(plan.work).toEqual(ids(6, 3)) // m3..m8: the open group, then the new rows
  const absorbed = applyPass(first, plan, parseGroups(reply([0, 5, 'b grown']), 6)!, 9)
  expect(JSON.stringify(absorbed.closed)).toBe(frozen)
  expect(absorbed.open).toEqual({ ids: ids(6, 3), title: 'b grown' })

  // Split: the earlier part closes, the newest rows open a new group.
  const plan2 = planPass(absorbed, ids(11))
  expect(plan2.work).toEqual(ids(8, 3))
  const split = applyPass(absorbed, plan2, parseGroups(reply([0, 4, 'b done'], [5, 7, 'c']), 8)!, 11)
  expect(JSON.stringify(split.closed.slice(0, 1))).toBe(frozen) // never changed
  expect(split.closed[1]).toEqual({ ids: ids(5, 3), title: 'b done' })
  expect(split.open).toEqual({ ids: ids(3, 8), title: 'c' })
})

test('a failed pass keeps the groups and draws the flat list', () => {
  const g = applyPass(EMPTY, planPass(EMPTY, ids(4)), parseGroups(reply([0, 3, 'a']), 4)!, 4)
  const failed = failPass(g, 9)
  expect(failed.closed).toEqual(g.closed)
  expect(failed.open).toEqual(g.open)
  expect(sections(failed, ids(9))).toBeUndefined()
  expect(sections(EMPTY, ids(3))).toBeUndefined() // no pass yet: flat
})

test('sections: closed, open, then In progress; a grouping that no longer fits is flat', () => {
  const g = applyPass(EMPTY, planPass(EMPTY, ids(4)), parseGroups(reply([0, 1, 'a'], [2, 3, 'b']), 4)!, 4)
  const parts = sections(g, ids(6))!
  expect(parts.map(p => [p.key, p.title, p.ids.length, p.status])).toEqual([
    ['m0', 'a', 2, 'closed'], ['m2', 'b', 2, 'open'], [IN_PROGRESS, IN_PROGRESS, 2, 'provisional'],
  ])
  expect(sections(g, ['m1', 'm0', 'm2', 'm3'])).toBeUndefined() // reordered
  expect(sections(g, ids(3))).toBeUndefined() // a grouped row missing

  // Closed groups start collapsed, the rest expanded; a choice wins.
  expect(parts.map(p => isCollapsed(p, {}))).toEqual([true, false, false])
  expect(parts.map(p => isCollapsed(p, { m0: false, m2: true }))).toEqual([false, true, false])
})

test('a pass runs on open with any new row, else every PASS_EVERY rows', () => {
  expect(PASS_EVERY).toBe(5)
  const g = { ...EMPTY, tried: 10 }
  expect(shouldPass(g, 10, true)).toBe(false)
  expect(shouldPass(g, 11, true)).toBe(true)
  expect(shouldPass(g, 10 + PASS_EVERY - 1, false)).toBe(false)
  expect(shouldPass(g, 10 + PASS_EVERY, false)).toBe(true)
})

test('a pass sends at most MAX_PASS_ROWS rows', () => {
  // First pass of a long session: the oldest close without Haiku.
  const plan = planPass(EMPTY, ids(MAX_PASS_ROWS + 12))
  expect(plan.work).toEqual(ids(MAX_PASS_ROWS, 12))
  expect(plan.frozen).toEqual([{ ids: ids(12), title: EARLIER }])

  // An open group too big to send again closes as it stands.
  const big = { ...EMPTY, open: { ids: ids(MAX_PASS_ROWS - 2), title: 'big' } }
  const plan2 = planPass(big, ids(MAX_PASS_ROWS + 3))
  expect(plan2.frozen).toEqual([big.open])
  expect(plan2.work).toEqual(ids(5, MAX_PASS_ROWS - 2))

  const plan3 = planPass(EMPTY, ids(10), 4)
  expect(plan3.work.length).toBe(4)
  const g = applyPass(EMPTY, plan3, parseGroups(reply([0, 3, 'new']), 4)!, 10)
  expect(sections(g, ids(10))!.map(p => p.title)).toEqual([EARLIER, 'new'])
})

test('the cursor moves between headers and stops at the ends', () => {
  const keys = ['a', 'b', 'c']
  expect(moveCursor(keys, undefined, 1)).toBe('c') // starts at the newest
  expect(moveCursor(keys, 'b', -1)).toBe('a')
  expect(moveCursor(keys, 'b', 1)).toBe('c')
  expect(moveCursor(keys, 'a', -1)).toBeUndefined() // scroll instead
  expect(moveCursor(keys, 'c', 1)).toBeUndefined()
  expect(moveCursor([], 'a', 1)).toBeUndefined()
})
