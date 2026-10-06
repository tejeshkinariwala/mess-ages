import type { Kind } from '../types'
import { HARD_WORDS, SOFT_WORDS, STYLE_RULES } from './style'
import { SEED_VERBS, vocabRules } from './verbs'

// The label prompts. Each takes the current vocabulary (see verbs.ts) and
// names it to the model as the verbs to prefer.

/** The seed verbs of one colour group, for the reply prompt's colour hint. */
const groupVerbs = (kind: Kind, vocab: readonly string[]) =>
  Object.keys(SEED_VERBS).filter(v => SEED_VERBS[v] === kind && vocab.includes(v)).join(', ') || 'none'

/** For a person's prompt. */
export function promptSystem(vocab: readonly string[]): string {
  return 'You label chat messages a person sends to an AI coding assistant. ' +
    `Reply with one label of 2 to ${SOFT_WORDS} words (up to ${HARD_WORDS} for two phases) that says what the message asks for. ` +
    vocabRules(vocab) + ' ' + STYLE_RULES + ' ' +
    'Examples: "remove: cap & test", "check: shared messages folder", "ask: permission to run tests & push", ' +
    '"plan: remove dots & ago", "ask: merge PR now?", "fix: login bug | push: branch", ' +
    '"fix: login redirect loop after password reset | push: branch & open PR". ' +
    'No quotes, no full stop, nothing else.'
}

/** For a reply: the first verb also picks the label's colour. */
export function replySystem(vocab: readonly string[]): string {
  return 'You label what an AI coding assistant is doing in one chat message. ' +
    `Reply with one label of 2 to ${SOFT_WORDS} words (up to ${HARD_WORDS} for two phases) that says what the message does. ` +
    vocabRules(vocab) + ' ' +
    `Start with a verb that says the kind of work: ${groupVerbs('edit', vocab)} for changing code or files; ` +
    `${groupVerbs('read', vocab)} for reading, searching, looking things up; ` +
    `${groupVerbs('run', vocab)} for commands, tests or builds; any other verb for answering, explaining, planning. ` +
    STYLE_RULES + ' ' +
    'Examples: "edit: remove cap & test | done: run tests", "report: fix pushed | ask: user to test", ' +
    '"read: other session shared code files", "wait: read-only agent report", ' +
    '"done: push panel fix", "plan: remove dots & ago", "ask: merge PR now?", ' +
    '"fail: disk full, writes blocked", "edit: replace word cap with soft & hard limits | run: plugin tests & tsc". ' +
    'No quotes, no full stop, nothing else.'
}

/**
 * The user turn sent with a message: the text in <message> tags and the
 * format repeated after it, so a long message does not crowd it out.
 */
export function labelPrompt(text: string): string {
  return `<message>\n${text}\n</message>\n` +
    'Label the message above. Reply with the label only: "verb: detail" segments joined by " | ", ' +
    `one lowercase verb per segment. Aim for ${SOFT_WORDS} words or fewer, counting the verbs: usually one segment, ` +
    `and one segment never over ${SOFT_WORDS}. ` +
    `Go up to ${HARD_WORDS} only for two phases joined by " | " when each phase needs its words. Never go over ${HARD_WORDS}.`
}
