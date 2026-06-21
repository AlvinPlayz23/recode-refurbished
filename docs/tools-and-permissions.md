# Tools And Permissions

Recode tools are model-callable capabilities exposed through the shared tool registry. The same tool layer is used by the TUI, one-shot CLI, ACP server, desktop app, and subagents.

## Built-in Tools

| Tool | Purpose |
| --- | --- |
| `Bash` | Run local shell commands. |
| `Read` | Read text files. |
| `Write` | Write files, creating parent directories when needed. |
| `Edit` | Replace one unique text fragment in a file. |
| `ApplyPatch` | Apply structured multi-file patches. |
| `Glob` | Find files by glob pattern. |
| `Grep` | Search file contents by regex. |
| `WebFetch` | Fetch a web page and convert/extract text. |
| `WebSearch` | Search the web through the configured search helper. |
| `Task` | Run a bounded subagent task. |
| `TodoWrite` | Maintain a task plan in the session. |
| `AskUserQuestion` | Ask structured clarification questions. |

## Approval Scopes

Tools are grouped into approval scopes:

| Scope | Tools |
| --- | --- |
| `read` | `Read`, `Glob`, `Grep`, `Task`, `TodoWrite`, `AskUserQuestion` |
| `edit` | `Write`, `Edit`, `ApplyPatch` |
| `bash` | `Bash` |
| `web` | `WebFetch`, `WebSearch` |

## Approval Modes

| Mode | Behavior |
| --- | --- |
| `approval` | `edit`, `bash`, and `web` require approval unless allowed by rules or allowlists. |
| `auto-edits` | `read` and `edit` run directly; `bash` and `web` require approval unless allowed. |
| `yolo` | All scopes run directly unless a permission rule denies them. |

Approval modes are UX guardrails, not a security sandbox.

## Allowlists

When an interactive approval popup offers "always allow", the selected approval scope can be persisted in `approvalAllowlist`:

```json
{
  "approvalAllowlist": ["edit"]
}
```

An allowlisted scope does not prompt unless a permission rule explicitly denies it.

## Permission Rules

Permission rules are pattern-based and can `allow`, `deny`, or `ask`:

```json
{
  "permissionRules": [
    { "permission": "bash", "pattern": "bun run test", "action": "allow" },
    { "permission": "bash", "pattern": "rm *", "action": "deny" },
    { "permission": "edit", "pattern": "src/**", "action": "ask" }
  ]
}
```

Rules are evaluated before approval-mode defaults. A `deny` rule blocks execution; an `allow` rule skips approval; an `ask` rule falls back to the active approval behavior.

## File Safety

Direct file tools use safe path resolution against the workspace root. They are intended to prevent accidental access outside the workspace through Recode's file APIs.

`Bash` is different. It runs local shell commands as a child process with your user permissions and should be treated as unsandboxed.

## File Mutation Queue

Write-like tools are scheduled through a mutation queue so concurrent tool calls do not blindly edit the same file at the same time. `ApplyPatch` uses patch headers to infer the affected path when possible.

## Subagent Tasks

The `Task` tool runs a bounded subagent task under the parent runtime configuration and tool policy. It is useful for focused investigation or parallelizable work, but it is still local Recode execution and not isolation.

## Web Tools

`WebFetch` and `WebSearch` are in the `web` approval scope. In `approval` and `auto-edits` modes they require approval unless allowlisted or allowed by permission rules.
