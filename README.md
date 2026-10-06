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

A made-up session with `/ages` open. In a wide terminal the panel sits beside the chat. Each message keeps its dim inline label (right-aligned under it); the panel lists the same messages, oldest first, with a short age in a fixed 5-character column and the summary after it:

```
 > what does the old inputs class save?                 │ Ages
       5m ago · checking what the old inputs class saves│ 3 earlier messages (no summary)
                                                        │ 5m   checking what the old inputs
 ● It saves the form fields and the last tab opened.    │      class saves
                   5m ago · reading the old inputs class│ 5m   reading the old inputs class
                                                        │ 2m   moving the save code to the new
 > move that into the new class                         │      class
          2m ago · moving the save code to the new class│ 2m   changing the save code in the
                                                        │      new class
 ● Done. I moved save() and load() into Inputs.         │ 30s  running the save tests
        2m ago · changing the save code in the new class│ now  saying the tests pass
                                                        │
 ● Running the tests.                                   │ [ Minimize ]
                        30s ago · running the save tests│
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
 5m   checking what the old inputs class saves
 5m   reading the old inputs class
 2m   moving the save code to the new class
 2m   changing the save code in the new class
 30s  running the save tests
 now  saying the tests pass
 [ Minimize ]
──────────────────────────────────────────────────
 >
```

The colours (see above) are not shown here.

## The `/ages` panel

Type `/ages` to open a side panel that lists the session's messages, oldest first, each row a short age with no "ago" (`now`, `30s`, `5m`, `30m+`) in a fixed column, then the summary with no separator, such as `5m   checking what the old inputs class saves`. Messages with no summary (old ones past the limit below, or ones still waiting) are not listed one by one: a single dim line such as `8 earlier messages (no summary)` counts them. Long summaries wrap in their own column, indented under the summary text. The arrow keys scroll it. To minimize it, press `Esc`, press `m` (the Minimize button), or type `/ages` again.

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

## Files

| File | What it does |
|---|---|
| `hooks/register.tsx` | Draws the labels and the `/ages` panel, queues the summary calls |
| `hooks/age.ts` | Age buckets, summary cleanup |
| `hooks/store.ts` | First-seen times, the panel rows, the back-generation limit (`BACKFILL_LIMIT`) |
| `hooks/kind.ts` | Work kinds, their colours, reading the kind from the summary |
| `hooks/*.test.ts(x)` | Tests |

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code generates locally for type checking. It is not in the repo.

## License

MIT
