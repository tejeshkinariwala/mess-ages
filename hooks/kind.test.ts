import { test, expect } from 'claude-code/testing'
import { parseLabel } from './kind'

test('reply kind and words', () => {
  expect(parseLabel('edit: Fix the Login Bug.')).toEqual({ kind: 'edit', words: 'fix the login bug' })
  expect(parseLabel('Read - look at the config file')).toEqual({ kind: 'read', words: 'look at the config file' })
  expect(parseLabel('RUN: run the tests')).toEqual({ kind: 'run', words: 'run the tests' })
  expect(parseLabel('explain the plan')).toEqual({ kind: 'other', words: 'explain the plan' })
  expect(parseLabel('note: something odd')).toEqual({ kind: 'other', words: 'note something odd' })
})
