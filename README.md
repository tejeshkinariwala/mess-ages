# mess-ages

A Claude Code plugin that puts a dim label under each of the last 20 messages:

```
10s ago · fixing a test to match new limit
```

- **Age:** how long ago the message appeared (`just now`, `5s ago`, `2m ago`, `30m+ ago`). Updates every 5 seconds.
- **Summary:** up to 8 plain words saying what the message is about, written by Sonnet at low effort. Each message is summarised once, when its text is final: your prompt at once, each of Claude's text blocks when its next tool call starts or the turn ends. The label does not change after it appears.

Thinking blocks get no label: Claude Code shows them like replies, but plugins cannot draw on them.

The label sits on its own line below the message, so tables and other wide output keep the full terminal width.

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
| `hooks/register.tsx` | Draws the labels and queues the summary calls |
| `hooks/age.ts` | Age buckets, the 20-message limit, summary cleanup |
| `hooks/*.test.ts(x)` | Tests |

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code generates locally for type checking. It is not in the repo.

## License

MIT
