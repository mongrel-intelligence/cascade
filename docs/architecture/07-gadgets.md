# Gadgets

Gadgets are the tool implementations that agents use to interact with their environment. They are the concrete operations behind capabilities — when an agent definition declares `fs:write`, the capability registry maps that to gadgets like `WriteFile`, `FileSearchAndReplace`, and `FileMultiEdit`.

## Capability-to-Gadget Mapping

The `CAPABILITY_REGISTRY` in `src/agents/capabilities/registry.ts` is the single source of truth:

```
Agent YAML definition
  → capabilities.required + optional
    → CAPABILITY_REGISTRY lookup
      → gadgetNames[] per capability
        → GADGET_CONSTRUCTORS instantiation
          → Gadget[] passed to engine
```

For **SDK engines** (LLMist): gadgets are instantiated as server-side classes and invoked directly when the LLM makes a tool call.

For **native-tool engines** (Claude Code, Codex, OpenCode): the engine uses its own built-in tools for file/shell operations. Domain tools (PM, SCM, alerting) are invoked via the `cascade-tools` CLI binary through Bash commands.

## Built-in Gadgets

### File system (`fs:read`, `fs:write`)

| Gadget | Capability | Purpose |
|--------|-----------|---------|
| `ListDirectory` | `fs:read` | List directory contents |
| `ReadFile` | `fs:read` | Read file contents |
| `RipGrep` | `fs:read` | Regex code search |
| `AstGrep` | `fs:read` | AST-based code search |
| `WriteFile` | `fs:write` | Write file contents |
| `FileSearchAndReplace` | `fs:write` | Search and replace in files |
| `FileMultiEdit` | `fs:write` | Multiple edits in a single file |
| `VerifyChanges` | `fs:write` | Verify edits produce expected results |

All file gadgets validate paths against allowed directories (working directory + `/tmp`). Write gadgets run post-edit diagnostics to catch syntax errors immediately.

### Shell (`shell:exec`)

| Gadget | Capability | Purpose |
|--------|-----------|---------|
| `Tmux` | `shell:exec` | Execute shell commands in a tmux session |
| `Sleep` | `shell:exec` | Wait for a specified duration |

### Session (`session:ctrl`)

| Gadget | Capability | Purpose |
|--------|-----------|---------|
| `Finish` | `session:ctrl` | Signal task completion |
| `TodoUpsert` | `session:ctrl` | Create or update a todo item |
| `TodoUpdateStatus` | `session:ctrl` | Mark todo as pending/in_progress/done |
| `TodoDelete` | `session:ctrl` | Remove a todo item |

Todos are stored in `.claude/todos.json` within the repo working directory.

### PM (`pm:read`, `pm:write`, `pm:checklist`)

| Gadget | Capability | Purpose |
|--------|-----------|---------|
| `ReadWorkItem` | `pm:read` | Fetch work item details |
| `ListWorkItems` | `pm:read` | List work items with filters |
| `UpdateWorkItem` | `pm:write` | Update work item fields |
| `CreateWorkItem` | `pm:write` | Create new work item |
| `MoveWorkItem` | `pm:write` | Move work item to a status/list |
| `PostComment` | `pm:write` | Post comment on work item |
| `AddChecklist` | `pm:write` | Add checklist to work item |
| `PMUpdateChecklistItem` | `pm:checklist` | Update checklist item status |
| `PMDeleteChecklistItem` | `pm:checklist` | Delete checklist item |

PM gadgets use the active `PMProvider` from `AsyncLocalStorage` context, making them provider-agnostic.

### SCM (`scm:read`, `scm:ci-logs`, `scm:comment`, `scm:review`, `scm:pr`)

| Gadget | Capability | Purpose |
|--------|-----------|---------|
| `GetPRDetails` | `scm:read` | Fetch PR metadata and state |
| `GetPRDiff` | `scm:read` | Get PR diff (additions/deletions) |
| `GetPRChecks` | `scm:read` | Get CI check status |
| `GetCIRunLogs` | `scm:ci-logs` | Download failed CI job logs |
| `PostPRComment` | `scm:comment` | Post issue comment on PR |
| `UpdatePRComment` | `scm:comment` | Update existing comment |
| `GetPRComments` | `scm:comment` | List PR comments |
| `ReplyToReviewComment` | `scm:comment` | Reply to inline review comment |
| `CreatePRReview` | `scm:review` | Submit code review |
| `CreatePR` | `scm:pr` | Create pull request |

### Alerting (`alerting:read`)

| Gadget | Capability | Purpose |
|--------|-----------|---------|
| `GetAlertingIssue` | `alerting:read` | Fetch Sentry issue details |
| `GetAlertingEventDetail` | `alerting:read` | Fetch specific event with stacktrace |
| `ListAlertingEvents` | `alerting:read` | List recent events for an issue |

## cascade-tools CLI

`src/cli/` — the `cascade-tools` binary

Native-tool engines cannot invoke gadget classes directly (they run as subprocesses). Instead, they call `cascade-tools` via Bash commands. The CLI is organized by category:

| Category | Commands | Example |
|----------|----------|---------|
| PM | `cascade-tools pm read-card`, `list-cards`, `update-card`, etc. | `cascade-tools pm read-card --cardId=abc123 --raw-json` |
| SCM | `cascade-tools github get-pr-details`, `get-diff`, `post-comment`, etc. | `cascade-tools github get-pr-details --pr-number=42` |
| Alerting | `cascade-tools sentry get-issue`, `list-events`, etc. | `cascade-tools sentry get-issue --issue-id=12345` |
| Session | `cascade-tools session todo-upsert`, `todo-status`, etc. | `cascade-tools session todo-upsert --id=1 --title="Fix tests"` |

The `cascade-tools` binary uses a separate oclif config (`bin/cascade-tools.js`) that discovers all non-dashboard commands, while `cascade` discovers only dashboard commands.

## Session State

`src/gadgets/sessionState.ts`

Gadgets communicate session-level state via a shared `SessionState` object:
- Progress comment ID (for updating in-place ack comments)
- GitHub auth mode (which persona is active)
- Read tracking — which files have been read (avoids re-reads)
- Edited files tracking — for post-edit diagnostics
