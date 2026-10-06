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

## The `/ages` panel

Type `/ages` to open a side panel that lists the session's messages, oldest first, as `age · summary`, with a short age and no "ago" (`now`, `30s`, `5m`, `30m+`). Messages with no summary (old ones past the limit below, or ones still waiting) are not listed one by one: a single dim line such as `8 earlier messages (no summary)` counts them. Long summaries wrap in their own column, indented under the summary text. The arrow keys scroll it. To minimize it, press `Esc`, press `m` (the Minimize button), or type `/ages` again.

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
