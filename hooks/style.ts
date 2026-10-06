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

/** The style rules shared by all three prompts. */
export const STYLE_RULES =
  'Style rules: ' +
  '1. Start with the plain base form of the action verb (remove, check, ask, wait, report). ' +
  'Never an -ing word, and never "finished", "plan to", "is", "was", "will". ' +
  'Say only the action and what it acts on; leave out tense. ' +
  '2. Write "&" instead of "and". ' +
  '3. Write " | " between two separate steps instead of filler words like "then". ' +
  '4. Drop "the", "a", "an" and filler words. Keep it short and plain. ' +
  '5. Optionally start with one status prefix when the state matters, else just the action: ' +
  '"plan:" not started, proposed; "done:" finished or verified; "ask:" needs a user answer or decision; ' +
  '"wait:" blocked on an agent, build or user; "fail:" an error or failure blocks it.'
