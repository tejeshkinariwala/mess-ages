import { test, expect } from 'claude-code/testing'
import { parseLabel } from './kind'

const kw = (raw: string, isPrompt = false) => {
  const { kind, words } = parseLabel(raw, isPrompt)
  return { kind, words }
}

test('the first verb picks the colour group; the verbs stay in the label', () => {
  expect(kw('edit: Fix the Login Bug.')).toEqual({ kind: 'edit', words: 'edit: fix the login bug' })
  expect(kw('Read - look at the config file')).toEqual({ kind: 'read', words: 'read: look at the config file' })
  expect(kw('RUN: run the tests')).toEqual({ kind: 'run', words: 'run: run the tests' })
  expect(kw('fix: login bug | push: branch')).toEqual({ kind: 'edit', words: 'fix: login bug | push: branch' })
  expect(kw('test: panel | done: push')).toEqual({ kind: 'run', words: 'test: panel | done: push' })
  expect(kw('done: push panel fix')).toEqual({ kind: 'other', words: 'done: push panel fix' })
  expect(kw('tidy: imports')).toEqual({ kind: 'other', words: 'tidy: imports' }) // unknown verb: neutral
})

test('old labels still parse', () => {
  expect(kw('explain the plan')).toEqual({ kind: 'other', words: 'explain the plan' })
  expect(kw('kind: edit: fix the login bug')).toEqual({ kind: 'edit', words: 'edit: fix the login bug' })
  expect(kw('edit: done: remove cap and test')).toEqual({ kind: 'edit', words: 'edit: done: remove cap & test' })
  expect(kw('other: wait: read-only agent report')).toEqual({ kind: 'other', words: 'other: wait: read only agent report' })
  expect(kw('kind: run: fail: disk full, writes blocked')).toEqual({ kind: 'run', words: 'run: fail: disk full, writes blocked' })
  expect(kw('other: ask: merge PR now?')).toEqual({ kind: 'other', words: 'other: ask: merge pr now?' })
})

test('a prompt is always input, whatever its verb', () => {
  expect(kw('edit: remove cap & test', true)).toEqual({ kind: 'input', words: 'edit: remove cap & test' })
  expect(kw('remove cap and test', true)).toEqual({ kind: 'input', words: 'remove cap & test' })
})
