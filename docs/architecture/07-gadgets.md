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

### PM (`pm:read`, `pm:write`, `pm:checklist`, `pm:friction`)

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
| `ReportFriction` | `pm:friction` | Queue and file incidental friction reports |

PM gadgets use the active `PMProvider` from `AsyncLocalStorage` context, making them provider-agnostic.

`ListWorkItems` accepts either a provider-native `containerId` or a CASCADE status filter. Prefer status filtering for pipeline stages:

```bash
cascade-tools pm list-work-items --status backlog
```

Status filtering calls `provider.listWorkItems(undefined, { status: "backlog" })`, so each provider resolves the configured native workflow state/list. This matters for Linear: `teamId` is a creation/search container and can include unmapped states, while `linear.statuses.backlog` is the only valid backlog selection state. Backlog-manager rejects unfiltered container-only listing to avoid selecting issues from unmapped Linear states such as Ideas.

`ReportFriction` is intentionally narrower than general PM write access. It lets agents file incidental papercuts in tooling, environment, permissions, dependencies, tests, PM data, or SCM data without exposing `CreateWorkItem` / `MoveWorkItem` directly. The CLI form is:

```bash
cascade-tools pm report-friction \
  --summary "Typecheck requires undocumented Redis env var" \
  --category environment \
  --severity medium \
  --whileDoing "Running pre-PR verification" \
  --details-file -
```

`--details-file -` reads Markdown details from stdin; use it for multi-line reproduction notes or shell output. The command always appends a queued event to the friction sidecar before it tries to create the PM work item, so a failed immediate write can be retried by the backend drain.

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
| `GetAlertingEventDetail` | `alerting:read` | Fetch Sentry issue-event details with stacktrace, tags, breadcrumbs, request data, and context |
| `ListAlertingEvents` | `alerting:read` | List recent events for an issue |

`GetAlertingEventDetail` accepts Sentry's issue-event response shape, including REST aliases from the [Retrieve an Issue Event API](https://docs.sentry.io/api/events/retrieve-an-issue-event/).

## cascade-tools CLI

`src/cli/` — the `cascade-tools` binary

Native-tool engines cannot invoke gadget classes directly (they run as subprocesses). Instead, they call `cascade-tools` via Bash commands. The CLI is organized by category:

| Category | Commands | Example |
|----------|----------|---------|
| PM | `cascade-tools pm read-work-item`, `list-work-items`, `update-work-item`, `report-friction`, etc. | `cascade-tools pm report-friction --summary "Missing setup hint" --details-file - --category tooling --severity medium` |
| SCM | `cascade-tools scm get-pr-details`, `get-pr-diff`, `post-pr-comment`, etc. | `cascade-tools scm get-pr-details --prNumber 42` |
| Alerting | `cascade-tools alerting get-alerting-issue`, `list-alerting-events`, etc. | `cascade-tools alerting get-alerting-issue --organizationId acme --issueId 12345` |
| Session | `cascade-tools session finish` | `cascade-tools session finish --comment "Created PR and verified checks"` |

The `cascade-tools` binary uses a separate oclif config (`bin/cascade-tools.js`) that discovers all non-dashboard commands, while `cascade` discovers only dashboard commands.

`createCLICommand()` is the stable facade used by command files under `src/cli/**`. Shared CLI behavior lives in focused helper modules under `src/gadgets/shared/cli/`:

| Helper | Role |
|--------|------|
| `commandNames.ts` | Command namespace/name derivation shared by the CLI factory and manifest generator |
| `examples.ts` | Tool example lookup, shell quoting, oclif example rendering, and JSON expected-shape hints |
| `flags.ts` | oclif flag construction and flag metadata collection |
| `booleanArgv.ts` | Boolean value-form normalization before oclif parsing |
| `parseErrors.ts` | oclif parse-error classification and unknown-flag suggestions |
| `params.ts` | File/stdin input, JSON parsing, direct parameter resolution, and git remote owner/repo resolution |
| `errorSink.ts` | Error-envelope routing through the active command instance |

New domain commands should not add branches in these helpers. They declare behavior through their `ToolDefinition` metadata (`cliAliases`, examples, file input alternatives, auto-resolution), and the shared generators consume it.

Core functions passed to `createCLICommand()` own domain work only. On fatal runtime/API/provider failures they throw, and the shared factory converts that exception into the structured `{"success":false,"error":{"type":"runtime","message":"..."}}` stdout envelope plus exit code 1. A returned value is always serialized as successful `data`, so gadgets must not return sentinel error strings such as `Error reading work item: ...` for fatal failures. Non-fatal command states that are part of the contract, such as guarded PM move no-ops or friction retry queueing, remain successful returns.

## Session State

`src/gadgets/sessionState.ts`

Gadgets communicate session-level state via a shared `SessionState` object:
- Progress comment ID (for updating in-place ack comments)
- GitHub auth mode (which persona is active)
- Read tracking — which files have been read (avoids re-reads)
- Edited files tracking — for post-edit diagnostics
