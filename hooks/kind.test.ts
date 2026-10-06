import { test, expect } from 'claude-code/testing'
import { parseLabel } from './kind'

test('reply kind and words', () => {
  expect(parseLabel('edit: Fix the Login Bug.')).toEqual({ kind: 'edit', words: 'fix the login bug' })
  expect(parseLabel('Read - look at the config file')).toEqual({ kind: 'read', words: 'look at the config file' })
  expect(parseLabel('RUN: run the tests')).toEqual({ kind: 'run', words: 'run the tests' })
  expect(parseLabel('explain the plan')).toEqual({ kind: 'other', words: 'explain the plan' })
  expect(parseLabel('note: something odd')).toEqual({ kind: 'other', words: 'note: something odd' })
  expect(parseLabel('kind: edit: fix the login bug')).toEqual({ kind: 'edit', words: 'fix the login bug' })
  expect(parseLabel('Kind: something odd')).toEqual({ kind: 'other', words: 'kind: something odd' })
})

test('status prefix after the kind, or alone', () => {
  expect(parseLabel('edit: done: remove cap and test')).toEqual({ kind: 'edit', words: 'done: remove cap & test' })
  expect(parseLabel('other: wait: read-only agent report')).toEqual({ kind: 'other', words: 'wait: read only agent report' })
  expect(parseLabel('kind: run: fail: disk full, writes blocked')).toEqual({ kind: 'run', words: 'fail: disk full, writes blocked' })
  expect(parseLabel('other: ask: merge PR now?')).toEqual({ kind: 'other', words: 'ask: merge pr now?' })
  expect(parseLabel('plan: remove dots & ago')).toEqual({ kind: 'other', words: 'plan: remove dots & ago' })
  expect(parseLabel('edit: remove cap & test')).toEqual({ kind: 'edit', words: 'remove cap & test' })
})
