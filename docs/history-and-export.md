# History And Export

Recode stores conversation history globally and can export terminal conversations as standalone HTML.

## Storage Location

Default history root:

```text
~/.recode/history/
```

The history root is derived from the config location, so custom `RECODE_CONFIG_PATH` values can move the associated history root.

## What Is Stored

Saved conversation records include:

- conversation metadata,
- workspace information,
- active provider/model metadata,
- transcript messages,
- current/last active conversation index data.

The transcript can include user messages, assistant messages, tool result messages, summary/compaction messages, step stats, and provider metadata such as reasoning content when needed for replay.

## TUI History

The TUI saves conversations automatically and can restore prior sessions. Use:

- `/history` to open saved conversations,
- `/new` to start a fresh conversation,
- `/compact` to summarize older context before continuing.

## One-shot History

One-shot CLI runs are saved by default. Use `--no-history` to opt out:

```bash
recode --no-history "answer without saving this transcript"
```

## Compaction

Compaction creates a summary message that replaces or condenses older context for the model. This helps keep long sessions within the model context window while preserving important continuity.

The TUI `/status` command shows current context-window data, reserved compaction buffer, last estimate, and summary count.

## HTML Export

Use `/export` in the TUI to write a standalone HTML transcript. The export includes:

- conversation title,
- provider/model metadata,
- transcript content,
- theme colors from the active Recode theme.

Exports are written to the current workspace root with a generated filename.

## Desktop History Note

The desktop app has its own desktop snapshot file at `~/.recode/desktop-sessions.json` for desktop workspace/thread UI state. Actual Recode session execution still goes through ACP and the shared runtime.
