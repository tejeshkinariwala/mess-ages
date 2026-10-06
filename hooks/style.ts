// The label style's one code-side rule: the word "and" becomes "&". Nothing
// else is rewritten; the prompts carry the rest of the style.

/**
 * Replaces each whole word "and" (any case, with whitespace on both sides)
 * with "&", outside `code spans`, then trims. Words that contain "and"
 * (band, android, src/and/x) are left alone.
 */
export function ampersand(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/(\s)and(?=\s)/gi, '$1&')))
    .join('')
    .trim()
}

/** A label's soft word limit: the usual most, and the most for one segment. */
export const SOFT_WORDS = 8
/** A label's hard word limit: only two phases joined by ` | ` may go past SOFT_WORDS, never past this. */
export const HARD_WORDS = 16

/** The length rule, built from the two limits; shared by all three prompts through STYLE_RULES. */
export const LENGTH_RULE =
  `Aim for ${SOFT_WORDS} words or fewer. ` +
  `Go up to ${HARD_WORDS} only for two phases joined by " | " when each phase needs its words. ` +
  `Never go over ${HARD_WORDS}. A single segment never goes over ${SOFT_WORDS}. ` +
  'Count every verb and every number as a word; a hyphen or dot splits words (8-word, file.tsx are two each). ' +
  'Drop detail rather than go over: name the main thing, not every item.'

/** The style rules shared by all three prompts. */
export const STYLE_RULES =
  'Style rules: ' +
  '1. Every verb and action word is a plain base form (remove, check, ask, wait, report). ' +
  'Never an -ing word, and never "finished", "plan to", "is", "was", "will". ' +
  'Say only the action and what it acts on; leave out tense. ' +
  '2. Write "&" instead of "and". ' +
  '3. Write " | " between two separate steps instead of filler words like "then". ' +
  '4. Drop "the", "a", "an" and filler words. Keep it short and plain. ' +
  '5. Use a status verb when the state matters: ' +
  '"plan:" not started, proposed; "done:" finished or verified; "ask:" needs a user answer or decision; ' +
  '"wait:" blocked on an agent, build or user; "fail:" an error or failure blocks it. ' +
  '6. ' + LENGTH_RULE
