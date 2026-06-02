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

`GetAlertingEventDetail` accepts Sentry's issue-event response shape, including REST aliases from the [Retrieve an Issue Event API](https://docs.sentry.io/api/events/retrieve-an-issue-event/). It fetches issue metadata best-effort and includes `Sentry issue: <permalink>` near the top when Sentry returns a permalink; if that metadata request fails, the event details still render.

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
| `suggestions.ts` | Shared Levenshtein scorer for flag and command typo suggestions (MNG-1440) |
| `flags.ts` | oclif flag construction and flag metadata collection |
| `booleanArgv.ts` | Boolean value-form normalization before oclif parsing |
| `parseErrors.ts` | oclif parse-error classification and unknown-flag suggestions |
| `params.ts` | File/stdin input, JSON parsing, direct parameter resolution, and git remote owner/repo resolution |
| `errorSink.ts` | Error-envelope routing through the active command instance |

New domain commands should not add branches in these helpers. They declare behavior through their `ToolDefinition` metadata (`cliAliases`, examples, file input alternatives, auto-resolution), and the shared generators consume it.

Core functions passed to `createCLICommand()` own domain work only. On fatal runtime/API/provider failures they throw, and the shared factory converts that exception into the structured `{"success":false,"error":{"type":"runtime","message":"..."}}` stdout envelope plus exit code 1. A returned value is always serialized as successful `data`, so gadgets must not return sentinel error strings such as `Error reading work item: ...` for fatal failures. Non-fatal command states that are part of the contract, such as guarded PM move no-ops or friction retry queueing, remain successful returns.

### Unknown-command typo suggestions (MNG-1442)

`bin/cascade-tools.js` registers an oclif `command_not_found` hook so command typos emit the same structured envelope every other CLI failure does (spec 014): JSON on stdout, prose on stderr, runnable `did you mean` hint when within the shared Levenshtein budget. Two cases the hook covers:

- **Unknown top-level topic** (`cascade-tools sm get-pr-diff`) — `expected` lists topics, `hint` preserves trailing segments (`did you mean 'cascade-tools scm get-pr-diff'?`).
- **Known topic, unknown subcommand** (`cascade-tools pm reaad-work-item`) — `expected` lists the topic's subcommands, `hint` runs the corrected form (`did you mean 'cascade-tools pm read-work-item'?`).

Far-away typos drop `hint` but still surface `expected` so the agent has a concrete recovery enumeration. Exit code is **`2`** for `unknown-command` — oclif's historical `command_not_found` default — distinct from every other envelope's exit code `1`.

The hook lives at `src/cli/_shared/command-not-found-hook.ts`, intentionally inside `_shared/` because `bin/cascade-tools.js`'s oclif command-discovery glob excludes `**/_shared/**`. The entrypoint wires it via `pjson.oclif.hooks.command_not_found` so oclif loads it dynamically only when needed — no static import is added, which preserves the existing friendly `dist/cli/bootstrap.js` missing path. The pure suggestion logic lives in `src/cli/_shared/commandSuggestions.ts` (MNG-1441) and is unit-tested directly without booting oclif; the hook is a thin wrapper that forwards `{config, id, argv}` into the helper and routes the envelope through `emitCliError` with an explicit exit-code-2 delegate. Candidates come strictly from the loaded oclif config (`config.commandIDs` plus non-hidden `pjson.oclif.topics`), so the `cascade-tools` binary never suggests dashboard topics that its discovery glob excludes.

### Mutation result contract (MNG-1422 → MNG-1428)

Every PM mutation core and the SCM PR comment/reply/update/review mutation cores covered by MNG-1428 return structured objects, never prose. The CLI factory serialises those objects verbatim into `{"success":true,"data":{...}}`, so consumers (downstream agents, sidecars, review/respond workflows) can read structured keys directly.

These targeted mutations surface these contract fields on `success.data`:

| Field | Meaning |
|---|---|
| `status` | The MUTATION OUTCOME — `"created"`/`"updated"`/`"moved"`/`"noop"`/`"aborted"`/`"deleted"` (PM) or `"ok"`/`"no-op"`/`"aborted"` (SCM). Branch on this, not on prose. |
| `updatedAt` | ISO 8601 timestamp string. It is always present and parseable; the source varies by mutation and fallback path. |

Identity and URL fields are mutation-specific. Work-item and comment mutations expose `id` plus their canonical resource URL (`url` or, for PM comments, `workItemUrl`). `AddChecklist` exposes `checklistId` and `workItemUrl`, plus `itemIds` / `itemCount`; `PMUpdateChecklistItem` and `PMDeleteChecklistItem` expose `checkItemId` and `workItemUrl`. Targeted SCM PR comment/reply/update/review mutations additionally surface `id`, `url`, `repoFullName`, and `prNumber` (the latter widens to `number | null` for `UpdatePRComment` when GitHub returns an issue-only comment URL). `CreatePRReview` extends with `reviewUrl`, `event`, `submittedAt`, and `inlineCommentCount`. `CreatePR` is also a structured SCM mutation, but it is outside MNG-1428's shared `status` / `updatedAt` / `id` / `url` contract and keeps its existing shape: `prNumber`, `prUrl`, `repoFullName`, and `alreadyExisted` plus optional commit/push details. The full per-mutation shapes live on the matching `ToolDefinition.outputShape` blocks under `src/gadgets/{pm,github}/definitions.ts`.

**`status` vs `workflowStatus` naming.** `status` is reserved for the mutation outcome alone. The PM provider's workflow state — Linear's "In Progress", a Trello list name, a JIRA status — lives on its own keys: `workflowStatus` (human-readable) and `workflowStatusId` (native ID). `MoveWorkItem` also exposes `previousStatus` / `previousStatusId` for the work item's pre-move workflow state on the guarded path. Mixing the two surfaces once cost ~2½ minutes of agent time (prod run `5d993b04`); the dual-key naming is now load-bearing.

**Fatal failures throw.** Cores propagate runtime/API/provider errors as exceptions; the CLI factory emits the spec-014 runtime envelope (`{"success":false,"error":{"type":"runtime","message":"..."}}`). Do NOT return sentinel strings like `"Error creating work item: ..."` — the CLI cannot distinguish a string return from a successful `data` payload, so the envelope would say `success: true` and the agent would silently mis-act.

**Timestamp fallback semantics.** The stable contract is that `updatedAt` is always present and parseable. `okResult` still rejects empty timestamps, so call sites using the shared success helper must provide one, but some successful PM writes synthesise timestamps today: `PostComment` uses `currentTimestamp()` for `created` / `updated`, and `MoveWorkItem` can fall back through `pickTimestamp(undefined)` for `moved`. `noOpResult` and `abortedResult` synthesise via `currentTimestamp()` because no provider write happened — the synthetic "now" reflects when the gadget evaluated the guard. Read-back failures after a successful checklist mutation fall back to a synthesised URL + timestamp in `readWorkItemContext` rather than masking the mutation success and risking an idempotency retry storm (Trello native-checklist retries duplicate rows).

The regression coverage lives in `tests/unit/cli/pm/pm-commands.test.ts`, `tests/unit/cli/scm/scm-commands.test.ts`, `tests/unit/gadgets/pm/definitions.test.ts`, and `tests/unit/gadgets/github/definitions.test.ts`. Run the focused suite with:

```bash
npx vitest run --project unit-core \
  tests/unit/cli/pm/pm-commands.test.ts \
  tests/unit/cli/scm/scm-commands.test.ts \
  tests/unit/gadgets/pm/definitions.test.ts \
  tests/unit/gadgets/github/definitions.test.ts
```

The full pre-PR gate remains `npm run lint && npm run typecheck && npm test`.

### Shell-safety contract (MNG-1059)

cascade-tools commands that accept text bodies, descriptions, or markdown payloads declare a `--*-file <path>` companion via `cli.fileInputAlternatives` (`--body-file`, `--text-file`, `--description-file`, `--details-file`, `--comments-file`). Agents are instructed to prefer the file form for any content containing backticks, code fences, `$(...)`, or newlines — shells expand those tokens even inside single quotes when the command is layered through `bash -c`, and newlines break argv parsing.

**Single-stdin-consumer invariant.** stdin (fd 0) can only be drained once per process. The shared CLI factory at `src/gadgets/shared/cli/params.ts` (`rejectMultipleStdinConsumers`) scans file-input flags for the literal `-` value and rejects any invocation with two or more stdin consumers — *before* any `readFileSync(0, ...)` call. The rejection emits a structured `flag-parse` error envelope so the agent can self-correct on the next attempt (write one payload to a temp file via `--*-file <path>` and stream the other via `--*-file -`). Direct file paths remain pairwise-compatible; only the dual-stdin combination is blocked.

**Large-diff escape hatch.** `cascade-tools scm get-pr-diff` accepts an optional `--outputFile <path>` flag (`cliOnly: true`). When set, the full multiline Markdown diff is written to disk and stdout contains only a compact summary `{outputFile, fileCount, bytes, pathFilter}`. This sidesteps terminal-truncation issues with one-line JSON patches that can be hundreds of kilobytes (see MNG-1045). Default behavior is preserved: without `--outputFile`, `get-pr-diff` returns the formatted Markdown directly.

## Session State

`src/gadgets/sessionState.ts`

Gadgets communicate session-level state via a shared `SessionState` object:
- Progress comment ID (for updating in-place ack comments)
- GitHub auth mode (which persona is active)
- Read tracking — which files have been read (avoids re-reads)
- Edited files tracking — for post-edit diagnostics
