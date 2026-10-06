import { test, expect } from 'claude-code/testing'

import { groupSystem } from './groups'
import { labelPrompt, promptSystem, replySystem } from './prompts'
import {
  PROMOTE_AT, SEED_VERBS, VOCAB_CAP, cutSegments, emptyVerbFile, isVerb, learn, normalizeLabel, parseSegments,
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

test('the 8-word cut runs across segments, verbs counted, none left dangling', () => {
  const segs = normalizeLabel('edit: remove cap & test | done: run all tests | push: branch now')
  // edit remove cap test (4) done run all tests (8): push is dropped whole.
  expect(segs).toEqual([{ verb: 'edit', detail: 'remove cap & test' }, { verb: 'done', detail: 'run all tests' }])
  expect(cutSegments([{ verb: 'a', detail: 'one two three four five six' }, { verb: 'bb', detail: 'x' }]))
    .toEqual([{ verb: 'a', detail: 'one two three four five six' }])
  // A later segment that does not fit whole goes, rather than leave "ask: try".
  expect(normalizeLabel('report: ages panel merged to main | ask: try /ages, delete branches?'))
    .toEqual([{ verb: 'report', detail: 'ages panel merged to main' }])
  expect(cutSegments([{ detail: 'one two three four five six seven eight nine ten' }]))
    .toEqual([{ detail: 'one two three four five six seven eight' }])
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
    expect(system).toContain('At most 8 words')
  }
  expect(labelPrompt('hi')).toMatch(/^<message>\nhi\n<\/message>\n.*verb: detail/s)
})
