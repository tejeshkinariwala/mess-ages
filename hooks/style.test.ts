import { test, expect } from 'claude-code/testing'
import { ampersand } from './style'
import { cleanSummary } from './age'
import { parseGroups } from './groups'

test('"and" becomes "&"', () => {
  expect(ampersand('remove cap and test')).toBe('remove cap & test')
  expect(ampersand('Build AND push and tag')).toBe('Build & push & tag')
  expect(ampersand('  check a\tand\tb  ')).toBe('check a\t&\tb')
})

test('"and" inside words, paths and code spans stays', () => {
  expect(ampersand('fix band and android')).toBe('fix band & android')
  expect(ampersand('edit src/and/x.ts')).toBe('edit src/and/x.ts')
  expect(ampersand('run `a and b` and test')).toBe('run `a and b` & test')
  expect(ampersand('and start, end and')).toBe('and start, end and')
})

test('no other rewriting', () => {
  expect(ampersand('checking the files')).toBe('checking the files')
})

test('summaries and group subtitles are normalized', () => {
  expect(cleanSummary('Remove cap and test')).toBe('remove cap & test')
  expect(cleanSummary('report fix pushed | ask user to test')).toBe('report fix pushed | ask user to test')
  expect(parseGroups('{"groups":[{"start":0,"end":0,"title":" Build and push "}]}', 1))
    .toEqual([{ start: 0, end: 0, title: 'Build & push' }])
})
