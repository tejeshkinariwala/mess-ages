# mess-ages

A Claude Code plugin that puts a dim label under every message:

```
10s ago · fixing a test to match new limit
```

- **Age:** how long ago the message appeared (`just now`, `5s ago`, `2m ago`, `30m+ ago`). Updates every 5 seconds, on one shared timer for all labels.
- **Summary:** up to 8 plain words saying what the message is about, written by Sonnet at low effort. Each message is summarised once, when its text is final: your prompt at once, each of Claude's text blocks when its next tool call starts or the turn ends. The label does not change after it appears.

Thinking blocks get no label: Claude Code shows them like replies, but plugins cannot draw on them.

- **Colour:** the summary is tinted by the kind of work, using your theme's colours so it reads in light and dark themes:

  | Kind | Colour | Means |
  |---|---|---|
  | input | blue | your prompt |
  | edit | green | Claude is changing code or files |
  | read | purple | reading, searching, looking things up |
  | run | amber | running commands, tests or builds |
  | other | grey | answers, explanations, plans |

  Your prompts are always `input`. For Claude's replies the same Sonnet call that writes the summary also picks the kind, so it costs nothing extra. Change the colours in `KIND_COLOR` in `hooks/kind.ts`.

The label sits on its own line below the message, so tables and other wide output keep the full terminal width.

## What it looks like

A made-up session with `/ages` open. In a wide terminal the panel sits beside the chat. Each message keeps its dim inline label (right-aligned under it); the panel lists the same messages, oldest first, in groups of work. Each group has a header with its subtitle and row count; under an expanded group each row is a short age in a fixed 5-character column and the summary after it:

```
 > what does the old inputs class save?                 │ Ages
       5m ago · checking what the old inputs class saves│ 3 earlier messages (no summary)
                                                        │ ▸ Reading the old inputs class (2)
 ● It saves the form fields and the last tab opened.    │ ▾ Moving save code to Inputs (2)
                   5m ago · reading the old inputs class│ 2m   moving the save code to the new
                                                        │      class
 > move that into the new class                         │ 2m   changing the save code in the
          2m ago · moving the save code to the new class│      new class
                                                        │ ▾ In progress (2)
 ● Done. I moved save() and load() into Inputs.         │ 30s  running the save tests
        2m ago · changing the save code in the new class│ now  saying the tests pass
                                                        │
 ● Running the tests.                                   │ [ Minimize ] [ Collapse all ]
                        30s ago · running the save tests│ [ Expand all ]
                                                        │
 ● All 12 tests pass.                                   │
                        just now · saying the tests pass│
────────────────────────────────────────────────────────┴──────────────────────────────────
 >
```

In a narrow terminal the panel sits above the prompt instead:

```
 ● All 12 tests pass.
                       just now · saying the tests pass

 Ages
 3 earlier messages (no summary)
 ▸ Reading the old inputs class (2)
 ▾ Moving save code to Inputs (2)
 2m   moving the save code to the new class
 2m   changing the save code in the new class
 ▾ In progress (2)
 30s  running the save tests
 now  saying the tests pass
 [ Minimize ] [ Collapse all ] [ Expand all ]
──────────────────────────────────────────────────
 >
```

Here `Reading the old inputs class` is a closed group, collapsed; `Moving save code to Inputs` is the open group, expanded; `In progress` holds the rows no grouping pass has seen yet.

The colours (see above) are not shown here.

## The `/ages` panel

Type `/ages` to open a side panel that lists the session's messages, oldest first, each row a short age with no "ago" (`now`, `30s`, `5m`, `30m+`) in a fixed column, then the summary with no separator, such as `5m   checking what the old inputs class saves`. Messages with no summary (old ones past the limit below, or ones still waiting) are not listed one by one: a single dim line such as `8 earlier messages (no summary)` counts them. Long summaries wrap in their own column, indented under the summary text. To minimize it, press `Esc`, press `m` (the Minimize button), or type `/ages` again.

### Groups

The panel groups its rows into chunks of work, each under a header such as `▾ Moving save code to Inputs (2)`: the subtitle says what was done or is being done, and the number counts the rows. `▸` marks a collapsed group, `▾` an expanded one.

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

Each summarised message is one small Sonnet call (up to 4,000 characters in, 40 tokens out). To change the model, effort or prompt, edit the `$.model.complete` call in `hooks/register.tsx`.

Grouping is one Sonnet call per pass: at most `MAX_PASS_ROWS` short rows in, up to 600 tokens out, every `PASS_EVERY` rows while the panel is open.

## Files

| File | What it does |
|---|---|
| `hooks/register.tsx` | Draws the labels and the `/ages` panel, queues the summary calls |
| `hooks/age.ts` | Age buckets, summary cleanup |
| `hooks/store.ts` | First-seen times, the panel rows, the back-generation limit (`BACKFILL_LIMIT`) |
| `hooks/groups.ts` | Panel groups: the Sonnet prompt, JSON checks, freezing, pass timing and the row cap (`PASS_EVERY`, `MAX_PASS_ROWS`) |
| `hooks/kind.ts` | Work kinds, their colours, reading the kind from the summary |
| `hooks/*.test.ts(x)` | Tests |

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code generates locally for type checking. It is not in the repo.

## License

MIT
