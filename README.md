# mess-ages

A Claude Code plugin that puts a dim label under every message:

```
10s ago · fix: test to match new limit
```

- **Age:** how long ago the message appeared (`just now`, `5s ago`, `2m ago`, `30m+ ago`). Updates every 5 seconds, on one shared timer for all labels.
- **Summary:** usually up to 8 plain words (at most 16 for two phases) saying what the message does, written by Sonnet at low effort in a short action style (see [Label style](#label-style)). Each message is summarised once, when its text is final: your prompt at once, each of Claude's text blocks when its next tool call starts or the turn ends. The label does not change after it appears.

Thinking blocks get no label: Claude Code shows them like replies, but plugins cannot draw on them.

- **Colour:** the summary is tinted by the kind of work its first verb names (see [Verbs](#verbs)), using your theme's colours so it reads in light and dark themes:

  | Kind | Colour | Means |
  |---|---|---|
  | input | blue | your prompt |
  | edit | green | Claude is changing code or files |
  | read | purple | reading, searching, looking things up |
  | run | amber | running commands, tests or builds |
  | other | grey | answers, explanations, plans |

  Your prompts are always `input`. For Claude's replies the first verb of the label picks the group: `edit: ...` is green, `test: ...` amber, `done: ...` grey. A label with several segments colours each verb by its own group and draws the details dim. Change the colours in `KIND_COLOR` in `hooks/kind.ts`, and which group a verb belongs to in `SEED_VERBS` in `hooks/verbs.ts`.

The label sits on its own line below the message, so tables and other wide output keep the full terminal width.

## Label style

A label is one or more `verb: detail` segments joined by ` | `:

```
edit: remove cap & test | done: run tests
```

- **verb:** one lowercase word (2 to 12 letters) followed by `: `. It names the kind of action or the state.
- **detail:** the plain words after it; never empty.
- **Length:** a soft limit of 8 words and a hard limit of 16, verbs counted (`SOFT_WORDS` and `HARD_WORDS` in `hooks/style.ts`). Aim for 8 or fewer; go up to 16 only for two phases joined by ` | ` when each phase needs its words; never over 16. One segment is the usual case; a second is only for a separate step or state. Group subtitles use the same limits.

The three Sonnet prompts (`promptSystem` and `replySystem` in `hooks/prompts.ts`, `groupSystem` in `hooks/groups.ts`) name the current verb list (see [Verbs](#verbs)) and share the rules in `STYLE_RULES` in `hooks/style.ts`:

1. Every verb and action word is a base form: `remove`, `check`, `ask`, not `removing`, `finished`, `plan to`, `is`, `was` or `will`.
2. Write `&` instead of "and".
3. Write `|` between two separate steps instead of filler words.
4. Leave out articles and filler words.
5. Use a status verb when the state matters:

   | Verb | Means | Example |
   |---|---|---|
   | `plan:` | not started, proposed | `plan: remove dots & ago` |
   | `done:` | finished or verified | `done: push panel fix` |
   | `ask:` | needs your answer or decision | `ask: merge PR now?` |
   | `wait:` | blocked on an agent, build or you | `wait: agent report` |
   | `fail:` | an error or failure blocks it | `fail: disk full, writes blocked` |

6. Aim for 8 words or fewer; go up to 16 only for two phases joined by `|`; never over 16.

More examples: `remove: cap & test`, `report: fix pushed | ask: user to test`, `check: shared messages folder`, `fix: login redirect loop after password reset | push: branch & open PR` (12 words, two phases); subtitles `Wait: build results & panel PR status`, `Delete: old git branches, keep main`.

The code changes a label in two ways. In every summary and group subtitle, the word "and" becomes `&` (`ampersand` in `hooks/style.ts`); words that contain "and", paths and `code spans` are left alone. Then one helper, `fitSegments` in `hooks/verbs.ts`, applies the length limits to every summary and group subtitle. A verb prefix (`edit:`) counts as one word; `&`, `|` and `:` standing alone do not. Several segments within 16 words in all are kept whole. Past 16, trailing segments are dropped whole at ` | ` until the rest fits, so no phrase is cut and no bare verb is left. A single segment past 8 words (as written, or left after the drop, even one past 16 on its own) is cut to its first 8 words. Verb learning counts only the verbs left in the shortened label.

Old labels still read. Plain words with no verb (`remove cap & test`) are a detail with no verb, drawn grey. The old reply form `edit: done: x` reads as verb `edit` with detail `done: x`, coloured green as before.

## Verbs

The verbs suggested to Sonnet come from two lists.

**Seed list** (`SEED_VERBS` in `hooks/verbs.ts`), each verb with its colour group:

| Group | Verbs |
|---|---|
| input (blue) | `input` |
| edit (green) | `edit`, `fix`, `add`, `remove`, `write`, `delete` |
| read (purple) | `read`, `check`, `review`, `search` |
| run (amber) | `run`, `test`, `push`, `merge`, `build` |
| other (grey) | `other`, `plan`, `done`, `ask`, `wait`, `fail`, `explain`, `decide`, `report` |

**Your list** is `~/.claude/mess-ages/verbs.json`, outside the repo. The plugin creates it the first time a label uses a verb:

```json
{ "learned": { "tidy": 1, "amend": 3, "edit": 12 }, "promoted": ["amend"], "removed": ["other"] }
```

- **learned:** how many labels used each verb. Seed verbs are counted too, for `/ages verbs`.
- **Learning rule:** when a label uses a verb that is not a seed verb, its count goes up. At 2 uses it moves to `promoted`, and Sonnet is offered it from then on. Learned verbs are drawn grey (`other`).
- **removed:** verbs never learned, counted or suggested again.
- Only a single lowercase word of 2 to 12 letters counts as a verb; anything else is ignored.
- Sonnet is offered at most 30 verbs: the seed list first, then promoted verbs by use count.
- A missing, unreadable or corrupt file counts as empty; the plugin never fails on it. The plugin reads the file once per session (and again after a plugin reload), keeps it in memory, and writes it back after each label that used a verb.

Commands (the answer appears as the command's message, as for `/ages auto`):

- `/ages verbs`: the seed and promoted verbs with use counts, then pending verbs with their count out of 2 (`tidy 1/2`), and removed verbs.
- `/ages verbs remove <verb>`: add the verb to `removed` and drop it from `learned` and `promoted`. A seed verb can be removed too: it is only hidden from the suggestions and no longer counted; labels that use it still parse and colour.
- `/ages verbs reset`: empty `learned`, `promoted` and `removed`.

## What it looks like

A made-up session with `/ages` open. In a wide terminal the panel sits beside the chat. Each message keeps its dim inline label (right-aligned under it); the panel lists the same messages, oldest first, in groups of work. Each group has a header with its subtitle and row count; under an expanded group each row is a short age in a fixed 5-character column and the summary after it:

```
 > what does the old inputs class save?                 │ Ages
              5m ago · check what old inputs class saves│ 3 earlier messages (no summary)
                                                        │ ▸ Check old inputs class (2)
 ● It saves the form fields and the last tab opened.    │ ▾ Move save code to Inputs (2)
                          5m ago · read old inputs class│ 2m   move save code to new class
                                                        │ 2m   done: move save code to
 > move that into the new class                         │      inputs
                    2m ago · move save code to new class│ ▾ In progress (2)
                                                        │ 30s  run save tests
 ● Done. I moved save() and load() into Inputs.         │ now  done: run save tests |
                 2m ago · done: move save code to inputs│      ask: push to main?
                                                        │
 ● Running the tests.                                   │ [ Minimize ] [ Collapse all ]
                                30s ago · run save tests│ [ Expand all ]
                                                        │
 ● All 12 tests pass. Push to main?                     │
    just now · done: run save tests | ask: push to main?│
────────────────────────────────────────────────────────┴──────────────────────────────────
 >
```

In a narrow terminal the panel sits above the prompt instead:

```
 ● All 12 tests pass. Push to main?
   just now · done: run save tests | ask: push to main?

 Ages
 3 earlier messages (no summary)
 ▸ Check old inputs class (2)
 ▾ Move save code to Inputs (2)
 2m   move save code to new class
 2m   done: move save code to inputs
 ▾ In progress (2)
 30s  run save tests
 now  done: run save tests | ask: push to main?
 [ Minimize ] [ Collapse all ] [ Expand all ]
──────────────────────────────────────────────────
 >
```

Here `Check old inputs class` is a closed group, collapsed; `Move save code to Inputs` is the open group, expanded; `In progress` holds the rows no grouping pass has seen yet.

The colours (see above) are not shown here.

## The `/ages` panel

Type `/ages` to open a side panel that lists the session's messages, oldest first, each row a short age with no "ago" (`now`, `30s`, `5m`, `30m+`) in a fixed column, then the summary with no separator, such as `5m   check what old inputs class saves`. Messages with no summary (old ones past the limit below, or ones still waiting) are not listed one by one: a single dim line such as `8 earlier messages (no summary)` counts them. Long summaries wrap in their own column, indented under the summary text. To minimize it, press `Esc`, press `m` (the Minimize button), or type `/ages` again.

### Groups

The panel groups its rows into chunks of work, each under a header such as `▾ Move save code to Inputs (2)`: the subtitle says what the work does, in the same style as the summaries, and the number counts the rows. `▸` marks a collapsed group, `▾` an expanded one.

Sonnet writes the groups (one small call at low effort). It gets the rows in order, each as its index, short age and summary, and answers with JSON: groups as contiguous index ranges, each with a subtitle. It never rewrites or reorders rows: the plugin keeps only the ranges, and checks that they start at the first row, follow each other with no gap or overlap, and end at the last row.

- **Closed groups never change.** Their rows and subtitle are frozen once made, and they start collapsed.
- **The last group is open.** Each pass sends Sonnet the open group and the rows after it, never the closed groups. The open group can take in the new rows, get a new subtitle, or split: its earlier part becomes a closed group and the newest rows start a new open group. It starts expanded.
- **In progress.** Rows that no pass has seen yet sit in a last group with the subtitle `In progress`.

A pass runs when `/ages` opens (if there are new rows) and then, while the panel is open, once `PASS_EVERY` (5) new summarized rows have appeared since the last pass; never once per message. A pass sends at most `MAX_PASS_ROWS` (30) rows. If there are more, an open group that would not fit closes as it stands, and the oldest of the new rows close in one `Earlier messages` group without a Sonnet call. Both constants are in `hooks/groups.ts`. Rows with no summary are never grouped: they stay in the `N earlier messages (no summary)` line.

Keys, while the panel has the keyboard (after `/ages`, or a click on it):

| Key | Does |
|---|---|
| `Up` / `Down` | Move the cursor (the highlighted header) to the previous or next group. Past the first or last header they scroll the panel, as do the mouse wheel and the page keys. |
| `Enter` | Collapse or expand the group under the cursor |
| `c` | Collapse all groups |
| `e` | Expand all groups |
| `Esc`, `m` | Minimize the panel |

A group you fold or unfold keeps that state across passes.

**Fallback.** If the Sonnet call fails, its reply is not valid JSON, or the ranges do not pass the checks above, the panel shows the flat list of rows with no groups, as before. The next pass (after `PASS_EVERY` more rows) tries again. The inline labels under messages never change.

### Open it automatically

To open the panel at the start of every Claude Code session, type `/ages auto on`. This creates an empty hidden file, `~/.claude/.mess-ages-always`; while it exists, the panel opens on its own when a session starts. An automatic open does not take the keyboard from the prompt, and the panel shows only when the terminal is at least 144 columns wide (it waits below that).

- `/ages auto on`: create the file, so the panel opens each session.
- `/ages auto off`: delete the file.
- `/ages auto`: say whether it is on.

You can also turn it off by deleting the file yourself: `rm ~/.claude/.mess-ages-always`. If the file is missing or cannot be read, auto-open is off. Plain `/ages` works as before.

## Limits

- **Live messages: no limit.** Every message that appears after your first prompt in this session gets an age label and a summary.
- **Old messages: newest 20.** When you resume a session, the messages already there get an age label but no summary. Opening `/ages` writes summaries for the newest 20 of them that have none. Older ones keep the age label only. To change the number, edit `BACKFILL_LIMIT` in `hooks/store.ts`.

## Install

Clone the repo, then add its path to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/mess-ages"
  }
}
```

Separate several plugin folders with `:`. Start a new Claude Code session to load it.

## Cost

Each summarised message is one small Sonnet call (up to 4,000 characters in, up to 60 tokens out, room for a 16-word label). To change the model, effort or prompt, edit the `$.model.complete` call in `hooks/register.tsx` or the prompts in `hooks/prompts.ts`.

Grouping is one Sonnet call per pass: at most `MAX_PASS_ROWS` short rows in, up to 600 tokens out, every `PASS_EVERY` rows while the panel is open.

## Files

| File | What it does |
|---|---|
| `hooks/register.tsx` | Draws the labels and the `/ages` panel, queues the summary calls |
| `hooks/age.ts` | Age buckets, summary cleanup |
| `hooks/style.ts` | The label style rules shared by the prompts, the `and` to `&` normalizer |
| `hooks/store.ts` | First-seen times, the panel rows, the back-generation limit (`BACKFILL_LIMIT`) |
| `hooks/groups.ts` | Panel groups: the Sonnet prompt, JSON checks, freezing, pass timing and the row cap (`PASS_EVERY`, `MAX_PASS_ROWS`) |
| `hooks/kind.ts` | Work kinds, their colours, reading a label and its colour group |
| `hooks/verbs.ts` | The verb vocabulary: seed list, `verbs.json` reading and learning, the segment parser and the 8/16-word length fit, `/ages verbs` |
| `hooks/prompts.ts` | The prompt and reply label prompts |
| `hooks/*.test.ts(x)` | Tests |

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code generates locally for type checking. It is not in the repo.

## License

MIT
