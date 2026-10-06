import { test, expect } from 'claude-code/testing'

import { groupSystem, parseGroups } from './groups'
import { HARD_WORDS, SOFT_WORDS } from './style'
import { labelPrompt, promptSystem, replySystem } from './prompts'
import {
  PROMOTE_AT, SEED_VERBS, VOCAB_CAP, emptyVerbFile, fitLabel, fitSegments, labelWords, isVerb, learn, normalizeLabel, parseSegments,
  parseVerbFile, serializeVerbFile, verbGroup, verbsCommand, vocabulary,
} from './verbs'

const seedCount = Object.keys(SEED_VERBS).length

test('parser: multi-segment labels', () => {
  expect(parseSegments('edit: remove cap & test | done: run tests')).toEqual([
    { verb: 'edit', detail: 'remove cap & test' }, { verb: 'done', detail: 'run tests' },
  ])
  expect(parseSegments('report: fix pushed | ask user to test')).toEqual([
    { verb: 'report', detail: 'fix pushed' }, { detail: 'ask user to test' },
  ])
})

test('parser: old formats', () => {
  expect(parseSegments('remove cap & test')).toEqual([{ detail: 'remove cap & test' }])
  expect(parseSegments('edit: done: x')).toEqual([{ verb: 'edit', detail: 'done: x' }])
  expect(parseSegments('other: explain plan')).toEqual([{ verb: 'other', detail: 'explain plan' }])
})

test('parser: garbage', () => {
  expect(parseSegments('')).toEqual([])
  expect(parseSegments(' | | ')).toEqual([])
  expect(parseSegments('done:')).toEqual([{ detail: 'done' }]) // no detail: the word alone
  expect(parseSegments('x: one letter verb')).toEqual([{ detail: 'x: one letter verb' }])
  expect(parseSegments('verylongverbname: x')).toEqual([{ detail: 'verylongverbname: x' }])
  expect(parseSegments('two words: x')).toEqual([{ detail: 'two words: x' }])
  expect(normalizeLabel('"!!!"')).toEqual([])
  expect(normalizeLabel('Edit:fix THE bug.')).toEqual([{ verb: 'edit', detail: 'fix the bug' }])
})

// n words: w1 w2 ... wn
const words = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `w${from + i}`).join(' ')
const seg = (verb: string | undefined, n: number, from = 1) => ({ ...(verb ? { verb } : {}), detail: words(n, from) })

test('limits: soft 8, hard 16', () => {
  expect(SOFT_WORDS).toBe(8)
  expect(HARD_WORDS).toBe(16)
})

test('word count: a verb prefix is one word; &, | and : alone are not', () => {
  expect(labelWords([{ verb: 'edit', detail: 'remove cap & test' }])).toBe(4)
  expect(labelWords([{ verb: 'edit', detail: 'a & b' }, { detail: 'c : d' }])).toBe(5)
  // A subtitle's capitalised verb is not parsed as a verb but still counts once.
  expect(labelWords([{ detail: 'Wait: a b' }])).toBe(3)
})

test('one segment: 8 kept, 9 cut to 8, verb counted', () => {
  expect(fitSegments([seg(undefined, 8)])).toEqual([seg(undefined, 8)])
  expect(fitSegments([seg(undefined, 9)])).toEqual([seg(undefined, 8)])
  expect(fitSegments([seg('edit', 7)])).toEqual([seg('edit', 7)]) // edit + 7 = 8
  expect(fitSegments([seg('edit', 8)])).toEqual([seg('edit', 7)]) // edit + 8 = 9: cut to edit + 7
  expect(fitSegments([{ verb: 'edit', detail: 'w1 w2 w3 w4 w5 w6 w7 & w8' }]))
    .toEqual([{ verb: 'edit', detail: 'w1 w2 w3 w4 w5 w6 w7' }]) // no trailing &
})

test('two segments: 9 and 16 in all kept whole, 17 drops the second', () => {
  const nine = [seg('edit', 5), seg('run', 2)] // 6 + 3
  expect(fitSegments(nine)).toEqual(nine)
  const sixteen = [seg('edit', 7), seg('run', 7)] // 8 + 8
  expect(labelWords(sixteen)).toBe(16)
  expect(fitSegments(sixteen)).toEqual(sixteen)
  const firstLong = [seg('edit', 11), seg('run', 3)] // 12 + 4: the first segment alone past 8 is fine here
  expect(fitSegments(firstLong)).toEqual(firstLong)
  // 8 + 9 = 17: the second goes whole, never cut mid-phrase.
  expect(fitSegments([seg('edit', 7), seg('run', 8)])).toEqual([seg('edit', 7)])
  // 12 + 5 = 17: the second goes, and the first alone is then cut to 8.
  expect(fitSegments([seg('edit', 11), seg('run', 4)])).toEqual([seg('edit', 7)])
})

test('trailing segments drop at | until the rest fits 16', () => {
  const three = [seg('edit', 5), seg('run', 5), seg('push', 5)] // 6 + 6 + 6 = 18
  expect(fitSegments(three)).toEqual(three.slice(0, 2))
  expect(normalizeLabel('edit: remove cap & test | done: run all tests | push: branch now'))
    .toEqual([{ verb: 'edit', detail: 'remove cap & test' }, { verb: 'done', detail: 'run all tests' }, { verb: 'push', detail: 'branch now' }])
})

test('first segment alone past 16 is cut to 8', () => {
  expect(fitSegments([seg('edit', 20), seg('run', 2)])).toEqual([seg('edit', 7)])
  expect(fitSegments([seg(undefined, 17)])).toEqual([seg(undefined, 8)])
})

test('model labels: "and" becomes & and the fit runs after it', () => {
  expect(normalizeLabel('fix: login redirect loop after password reset | push: branch and open PR'))
    .toEqual([{ verb: 'fix', detail: 'login redirect loop after password reset' }, { verb: 'push', detail: 'branch & open pr' }])
  expect(normalizeLabel('report: ' + words(12))).toEqual([{ verb: 'report', detail: words(7) }])
})

test('group subtitles use the same limits', () => {
  expect(fitLabel('Fix: label cap in prompts & helper | test: boundary cases & push PR'))
    .toBe('Fix: label cap in prompts & helper | test: boundary cases & push PR')
  expect(fitLabel(`Fix: ${words(10)}`)).toBe(`Fix: ${words(7)}`)
  expect(fitLabel(`Fix: ${words(7)} | test: ${words(9)}`)).toBe(`Fix: ${words(7)}`)
  const reply = (title: string) => JSON.stringify({ groups: [{ start: 0, end: 0, title }] })
  expect(parseGroups(reply(`Build and ${words(3)} | test: ${words(4)}`), 1)?.[0]?.title)
    .toBe(`Build & ${words(3)} | test: ${words(4)}`)
  expect(parseGroups(reply(`Fix: ${words(20)}`), 1)?.[0]?.title).toBe(`Fix: ${words(7)}`)
})

test('learning: counts, promotes at 2, ignores invalid verbs', () => {
  let f = emptyVerbFile()
  f = learn(f, ['tidy', 'edit', undefined, 'Bad', 'x', 'waytoolongverb', 'two words'])
  expect(f.learned).toEqual({ tidy: 1, edit: 1 })
  expect(f.promoted).toEqual([])
  f = learn(f, ['tidy', 'tidy']) // one label counts a verb once
  expect(f.learned.tidy).toBe(PROMOTE_AT)
  expect(f.promoted).toEqual(['tidy'])
  f = learn(f, ['edit', 'edit'])
  expect(f.promoted).toEqual(['tidy']) // seed verbs are counted, never promoted
  expect(learn(f, [undefined, 'B4d'])).toBe(f) // nothing to learn: same object
  expect(isVerb('ok')).toBe(true)
  expect(isVerb('o')).toBe(false)
})

test('learning: removed verbs are never learned or suggested', () => {
  let f = { ...emptyVerbFile(), removed: ['tidy', 'push'] }
  f = learn(learn(f, ['tidy', 'push']), ['tidy'])
  expect(f.learned).toEqual({})
  expect(f.promoted).toEqual([])
  expect(vocabulary(f)).not.toContain('push')
  expect(vocabulary(f)).not.toContain('tidy')
})

test('vocabulary: seed first, promoted by use count, capped at 30', () => {
  const learned: Record<string, number> = {}
  const promoted: string[] = []
  for (let i = 0; i < 20; i++) {
    const v = `zz${String.fromCharCode(97 + i)}`
    learned[v] = 2 + i
    promoted.push(v)
  }
  const vocab = vocabulary({ learned, promoted, removed: [] })
  expect(vocab.length).toBe(VOCAB_CAP)
  expect(vocab.slice(0, seedCount)).toEqual(Object.keys(SEED_VERBS))
  expect(vocab[seedCount]).toBe('zzt') // the most used first
  expect(vocab[seedCount + 1]).toBe('zzs')
})

test('colour groups: seed verbs keep theirs; unknown is other', () => {
  expect(verbGroup('fix')).toBe('edit')
  expect(verbGroup('check')).toBe('read')
  expect(verbGroup('test')).toBe('run')
  expect(verbGroup('input')).toBe('input')
  expect(verbGroup('tidy')).toBe('other')
  expect(verbGroup(undefined)).toBe('other')
  expect(verbGroup('constructor')).toBe('other')
})

test('file robustness: missing, corrupt or wrong shapes read as empty', () => {
  expect(parseVerbFile(undefined)).toEqual(emptyVerbFile())
  expect(parseVerbFile('')).toEqual(emptyVerbFile())
  expect(parseVerbFile('{not json')).toEqual(emptyVerbFile())
  expect(parseVerbFile('[1,2]')).toEqual(emptyVerbFile())
  expect(parseVerbFile('null')).toEqual(emptyVerbFile())
  expect(parseVerbFile('{"learned":[1],"promoted":"x","removed":{}}')).toEqual(emptyVerbFile())
  expect(parseVerbFile('{"learned":{"tidy":3,"BAD":2,"neg":-1,"str":"2"},"promoted":["tidy","edit","Bad",1],"removed":["zap"]}'))
    .toEqual({ learned: { tidy: 3 }, promoted: ['tidy'], removed: ['zap'] })
  const f = { learned: { tidy: 2 }, promoted: ['tidy'], removed: ['zap'] }
  expect(parseVerbFile(serializeVerbFile(f))).toEqual(f)
})

test('command: list, remove, reset', () => {
  const f = { learned: { tidy: 3, edit: 5, zap: 1 }, promoted: ['tidy'], removed: [] as string[] }
  const list = verbsCommand(f, [], '/h/verbs.json')
  expect(list.changed).toBe(false)
  expect(list.text).toContain('edit (5)')
  expect(list.text).toContain('learned: tidy (3)')
  expect(list.text).toContain('pending: zap 1/2')
  expect(list.text).toContain('/h/verbs.json')

  const removed = verbsCommand(f, ['remove', 'tidy'], '/h/verbs.json')
  expect(removed.changed).toBe(true)
  expect(removed.file).toEqual({ learned: { edit: 5, zap: 1 }, promoted: [], removed: ['tidy'] })
  const seed = verbsCommand(removed.file, ['remove', 'push'], '/h/verbs.json')
  expect(seed.text).toContain('seed verb')
  expect(vocabulary(seed.file)).not.toContain('push')
  expect(verbsCommand(seed.file, [], '/h').text).toContain('removed: tidy, push')

  expect(verbsCommand(f, ['remove', 'Not A Verb'], '/h').changed).toBe(false)
  expect(verbsCommand(f, ['remove'], '/h').text).toContain('Usage')
  expect(verbsCommand(f, ['bogus'], '/h').text).toContain('Usage')

  const reset = verbsCommand(seed.file, ['reset'], '/h')
  expect(reset.changed).toBe(true)
  expect(reset.file).toEqual(emptyVerbFile())
})

test('all three prompts carry the vocabulary and the format', () => {
  const vocab = vocabulary({ learned: { tidy: 2 }, promoted: ['tidy'], removed: ['push'] })
  for (const system of [promptSystem(vocab), replySystem(vocab), groupSystem(vocab)]) {
    expect(system).toContain('Prefer these verbs: input, edit, read')
    expect(system).toContain('tidy')
    expect(system).not.toMatch(/Prefer these verbs:[^.]*\bpush\b/)
    expect(system).toContain('" | "')
    expect(system).toContain('Use a new single lowercase verb only if none of these fits')
    expect(system).toContain('Write "&" instead of "and"') // the style rules stay
    expect(system).toContain('Aim for 8 words or fewer')
    expect(system).toContain('Go up to 16 only for two phases')
    expect(system).toContain('Never go over 16')
  }
  expect(labelPrompt('hi')).toMatch(/^<message>\nhi\n<\/message>\n.*verb: detail.*8 words or fewer.*Never go over 16/s)
})
