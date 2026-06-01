# cascade-tools gadget authoring

`cascade-tools` is the CLI surface LLM agents use to drive CASCADE — it sits between every review / implementation / backlog agent and the outside world (PM APIs, GitHub, session lifecycle). Its ergonomics for an LLM reader are load-bearing: a confusing flag name, a malformed `--help`, or a cryptic error can cost minutes of run budget (see [spec 014](../../docs/specs/014-cascade-tools-agent-ergonomics.md.done) — prompted by prod run `5d993b04-6e05-4ae1-b7de-8c274cf3496b` where an agent burned ~2½ min of a 7m42s run fighting `scm create-pr-review` and ultimately dropped an inline review comment).

This document is the canonical guide for **adding a new gadget** (a `cascade-tools <cat> <name>` command) and keeping its agent-facing surface truthful, runnable, and self-correctable.

Current command namespaces are category-based: `pm` for work items and checklists, `scm` for GitHub PR operations, `alerting` for Sentry issue/event reads, and `session` for run completion. Keep examples aligned with the concrete command files under `src/cli/<namespace>/`.

---

## Architecture in one picture

A gadget is a single `ToolDefinition` consumed by three generators:

```
ToolDefinition ───▶ gadgetFactory    ▶ the Zod-validated in-process gadget
                ├─▶ cliCommandFactory ▶ the oclif `cascade-tools` subcommand
                └─▶ manifestGenerator ▶ the ToolManifest the agent sees in its system prompt
```

All three read from the same definition. **If you want a behavior to land, declare it on the ToolDefinition — do not edit the generators per-gadget.**

---

## Declarative metadata you can attach

### `cliAliases?: readonly string[]`

Alternative flag names accepted on the CLI. Wired into oclif as `Flags.*({ aliases: [...] })`; surfaced in the agent's system prompt so the rendered flag line looks like `--comments|--comment '<json>'`. Use this when agent muscle memory reaches for an understandable-but-wrong spelling (singular/plural collisions, British/American spellings, historical renames).

```ts
comments: {
  type: 'array',
  items: 'object',
  describe: 'Inline review comments on specific files/lines.',
  cliAliases: ['comment'], // agent typing `--comment '[...]'` now resolves correctly
  optional: true,
},
```

The canonical parameter name always wins. Aliases are additive; suggestions returned by the fuzzy-matcher always point at the canonical form.

For array-of-object CLI params, the canonical input remains a JSON array. The shared parser also accepts one top-level JSON object and normalizes it to a one-element array so aliases like `--comment '{"path":"src/x.ts","line":1,"body":"nit"}'` behave the way agents naturally expect. Arrays pass through unchanged, and the parser validates only the top-level JSON shape; it does not inspect individual array entries.

### `cli.fileInputAlternatives`

Opt-in `--<param>-file <path>` escape hatches for long or JSON-shaped payloads that don't survive shell quoting. Pair with `parseAs: 'json'` for array-of-object / object params so the file contents are `JSON.parse`-d before reaching the gadget.

```ts
cli: {
  fileInputAlternatives: [
    {
      paramName: 'comments',
      fileFlag: 'comments-file',
      parseAs: 'json',
      description: 'Read --comments JSON from file (use - for stdin). Prefer this for long payloads.',
    },
  ],
},
```

`-` as the file path reads from stdin. The generated flag is always optional (the direct flag remains accepted).

**One-stdin-consumer rule (MNG-1059).** stdin (fd 0) can only be drained once per process. If a command declares two file-input alternatives and the agent passes `--body-file - --comments-file -` in one invocation, the first `readFileSync(0, ...)` consumes every byte and the second consumer silently gets an empty string — one of the agent's payloads is dropped without any error.

The shared CLI factory rejects this combination structurally *before* any read occurs: it emits a `flag-parse` envelope with `error.flag: 'body-file,comments-file'` and a hint to write one payload to a temp file. Direct file paths remain compatible — `--body-file - --comments-file /tmp/comments.json` and `--body-file /tmp/body.md --comments-file -` both work as before. The guard is automatic; gadget authors do not call it directly.

Description text on `--*-file` flags should explicitly call out markdown / multiline / backticks / `$(...)` so the manifest renderer and `--help` output steer agents toward the file form before they hit a quoting bug. The single-stdin rule is automatically surfaced in the rendered system prompt under "cascade-tools shell-safety rules"; per-command examples should also model the safe pattern when relevant.

### `cliOnly: true` on a parameter

`ParameterDefinition.cliOnly` flags a parameter as a CLI-only surface — included in the CLI flags and in the agent-facing tool manifest (so the prompt shows it), but **excluded** from the Zod schema the SDK Gadget exposes. Use this for output destination flags that have no meaningful in-process equivalent.

Reference: `getPRDiffDef.parameters.outputFile` in `src/gadgets/github/definitions.ts`. When `--outputFile <path>` is set, the CLI writes the full Markdown diff to disk and returns a compact summary (`{outputFile, fileCount, bytes, pathFilter}`) instead of pumping the full multi-megabyte payload through stdout. The SDK gadget would have no clean way to deliver that file back through its return-string contract, so the flag is marked `cliOnly`.

`cliOnly` is mutually exclusive with `gadgetOnly` — the former excludes from the gadget; the latter excludes from the CLI + manifest.

### `examples`

A list of `{ params, comment, output? }` invocations. The first example that populates a given parameter becomes that parameter's **concrete example**, surfaced in three places:

- The agent's system prompt renders a one-line `# example: ...` under the flag. Object params and array-of-object params use a single shell-quoted JSON payload. Scalar, enum, number, and primitive-array params render as actual CLI syntax.
- The `cascade-tools … --help` output lists every example as a runnable shell invocation under an `EXAMPLES` section.
- JSON-parse failures include the example as the `expected` shape fragment in the structured error envelope.

Write examples that a model could literally copy/paste. Use double-quoted JSON keys; do not rely on the agent to translate pseudo-JSON. Shell-safe scalar IDs and names should stay bare (`--workItemId abc123`, `--owner acme`, `--prNumber 42`), not wrapped in quote characters. The shared renderer adds shell quotes only when a scalar contains spaces, shell metacharacters, or embedded quotes.

Enum examples must be raw CLI values, not JSON strings. For example, the review action should render as:

```bash
cascade-tools scm create-pr-review --event APPROVE
```

not `--event '"APPROVE"'`. Primitive arrays should render as repeated flags (`--labels bug --labels docs`), while array-of-object examples like `comments` stay JSON (`--comments '[{"path":"src/x.ts","line":1,"body":"nit"}]'`).

```ts
examples: [
  {
    params: {
      comment: 'Requesting changes for identified issues',
      owner: 'acme',
      repo: 'myapp',
      prNumber: 42,
      event: 'REQUEST_CHANGES',
      body: 'Good progress, but…',
      comments: [
        { path: 'src/utils.ts', line: 15, body: 'This could cause a null pointer…' },
      ],
    },
    comment: 'Request changes with inline comments',
  },
],
```

---

## The error envelope

Every cascade-tools failure — flag parse, JSON parse, missing-required, enum-mismatch, unknown-flag, auth, runtime — emits through the shared `emitCliError` helper:

- **Structured JSON on stdout** (`{ "success": false, "error": {...} }`) so agents parse a single stable surface.
- **One-line prose summary on stderr** so humans running the CLI directly get a readable error without piping through `jq`.
- **Exit code 1.**

The envelope shape is part of the cascade-tools contract. Renaming fields is a breaking change — agents rely on `error.type` / `error.flag` / `error.hint` to self-correct on the next attempt.

Envelope fields:

| field | when populated |
|---|---|
| `type` | always; one of `flag-parse` / `json-parse` / `missing-required` / `enum-mismatch` / `unknown-flag` / `auth` / `runtime` |
| `flag` | for flag-scoped failures |
| `message` | always; human-readable |
| `got` | the offending input, truncated to ~80 chars |
| `expected` | shape fragment (from `example` when available, else `describe`) |
| `hint` | an action the agent can take (e.g. `did you mean --comments?`, `use --comments-file <path>`) |
| `example` | runnable invocation, when known |

You do not call `emitCliError` directly. The shared factory routes every failure through it automatically — your job is to make the declarative metadata (describe text, examples, aliases, file alternatives) rich enough that the auto-generated envelope is actually useful.

Core gadget functions must throw for fatal runtime/API/provider failures. Do not return sentinel prose such as `Error posting comment: ...`; `createCLICommand()` treats returned values as successful `data`, and thrown errors as runtime failure envelopes. Intentional non-fatal outcomes may still return structured data or explicit status text when they are part of the command contract, such as guarded PM move no-ops or friction reports queued for retry.

---

## Mutation result contract (MNG-1422 → MNG-1428)

Every PM and SCM mutation core returns a structured object — never prose. The CLI factory serialises that object verbatim into the `{ "success": true, "data": {...} }` stdout envelope, so consumers (downstream agents, sidecar tooling, review/respond workflows) can read structured keys without regex'ing sentence fragments. Mutation outcomes use the shared shapes declared in `src/gadgets/pm/core/mutationResults.ts` and `src/gadgets/github/core/mutationResults.ts`.

### Mutation identity and status fields

| Field | Meaning |
|---|---|
| `status` | The MUTATION OUTCOME — `"created"` / `"updated"` / `"moved"` / `"noop"` / `"aborted"` / `"deleted"` (PM) or `"ok"` / `"no-op"` / `"aborted"` (SCM). Branch on this, not on prose. |
| `updatedAt` | ISO 8601 timestamp string. It is always present and parseable; the source varies by mutation and fallback path. |

Identity and URL fields are mutation-specific:

- Work-item and comment mutations expose `id` plus their canonical resource URL (`url` or, for PM comments, `workItemUrl`).
- `AddChecklist` exposes `checklistId` and `workItemUrl`, plus `itemIds` / `itemCount`.
- `PMUpdateChecklistItem` and `PMDeleteChecklistItem` expose `checkItemId` and `workItemUrl`.
- SCM mutations expose `id`, `url`, and the parent PR context: `repoFullName` (e.g. `"acme/myapp"`) and `prNumber` (or `number | null` for the rare issue-only `UpdatePRComment` case). `CreatePRReview` extends that shape with `reviewUrl`, `event`, `submittedAt`, and `inlineCommentCount`.

### `status` vs `workflowStatus` naming — do not conflate

`status` is reserved for the **mutation outcome** alone. The PM provider's **workflow state** (e.g. Linear's "In Progress", a Trello list name, a JIRA status) lives on its own keys:

- `workflowStatus` (string, optional) — human-readable workflow state name.
- `workflowStatusId` (string, optional) — provider-native ID (Linear state UUID, Trello list ID).
- `previousStatus` / `previousStatusId` on `MoveWorkItem` — the work item's pre-move workflow state read back from the provider on the guarded path.

A historical mix-up between the two surfaces cost ~2½ minutes of agent time once (prod run `5d993b04`) when an agent treated a Trello list name surfaced through a `status` key as a mutation outcome. The dual-key naming is now load-bearing — keep mutation outcomes and workflow states on separate fields.

### Fatal failures throw — no prose sentinels

Mutation cores propagate runtime / API / provider errors as thrown exceptions. The shared `createCLICommand()` factory wraps them in the spec-014 runtime envelope:

```json
{ "success": false, "error": { "type": "runtime", "message": "Provider 422" } }
```

Do not return strings like `"Error creating work item: ..."` from a mutation core. The CLI cannot distinguish a sentinel-string return from a successful `data` payload, so the envelope would say `success: true` and the agent would silently mis-act on the prose.

The only exceptions are intentional non-fatal outcomes that are part of the contract — e.g. `MoveWorkItem` returning `status: "noop"` when the work item is already in the destination, or `ReportFriction` returning `status: "queued_slot_missing"` when the friction slot isn't configured. These are structured returns, not prose sentinels.

### Timestamp fallback semantics

The stable contract is that `updatedAt` is present and parseable. Its source varies:

- `okResult(providerTs)` still rejects empty timestamps, so call sites that use the shared success helper must provide a timestamp.
- Some successful PM writes synthesise timestamps today: `PostComment` uses `currentTimestamp()` for its `created` / `updated` outcomes, and `MoveWorkItem` can fall back through `pickTimestamp(undefined)` for `moved`.
- `"noop"` / `"aborted"` outcomes synthesise via `currentTimestamp()` because no provider write happened. The synthetic "now" reflects when the gadget evaluated the guard, not a provider write.
- Read-back failures after a successful checklist mutation fall back to a synthesised URL + timestamp inside `readWorkItemContext` rather than masking the mutation success and risking an idempotency retry storm (especially on Trello's native checklists, where retries duplicate rows).

### Focused verification command (MNG-1428)

The regression coverage for this contract lives in three test files. To re-run them in isolation:

```bash
npx vitest run --project unit-core \
  tests/unit/cli/pm/pm-commands.test.ts \
  tests/unit/cli/scm/scm-commands.test.ts \
  tests/unit/gadgets/pm/definitions.test.ts \
  tests/unit/gadgets/github/definitions.test.ts
```

Each suite parses the CLI stdout envelope and asserts `success.data.status`, parseable `success.data.updatedAt`, and the mutation-specific identity/URL fields (`id` / `url`, `workItemUrl`, `checklistId`, or `checkItemId` as applicable, plus `repoFullName` / `prNumber` for SCM). The suites also pin the runtime envelope shape for thrown core failures. The output-shape tests in the gadget-definition suites pin the `status` vs `workflowStatus` split as well.

The full pre-PR gate is unchanged:

```bash
npm run lint        # biome check (also via lint:fix during iteration)
npm run typecheck   # tsc --noEmit
npm test            # all four unit projects
```

Changed surfaces touched by this contract: PM mutation cores under `src/gadgets/pm/core/`, SCM mutation cores under `src/gadgets/github/core/`, the matching CLI commands under `src/cli/pm/` and `src/cli/scm/`, and the `outputShape` blocks on the matching `ToolDefinition`s in `src/gadgets/{pm,github}/definitions.ts`.

---

## Shared CLI helper layout

`createCLICommand()` is intentionally the stable public facade for command files under `src/cli/**`. Its implementation delegates to focused helpers under `src/gadgets/shared/cli/`:

| Helper | Responsibility |
|---|---|
| `commandNames.ts` | Kebab-case conversion and `cascade-tools <namespace> <command>` derivation shared with manifest generation |
| `examples.ts` | Example lookup, oclif example rendering, and JSON expected-shape hints |
| `shellValues.ts` | Shared shell-safe scalar and JSON payload formatting for CLI help and native-tool prompts |
| `flags.ts` | oclif flag construction plus candidate and boolean-flag metadata collection |
| `booleanArgv.ts` | Natural boolean value forms such as `--flag true`, `--flag=false`, `yes/no`, and `1/0` |
| `parseErrors.ts` | oclif parse-error classification and unknown-flag suggestions |
| `params.ts` | File/stdin input, JSON parsing, direct parameter resolution, and git remote owner/repo resolution |
| `errorSink.ts` | Routing error envelopes through the active oclif command instance |

These modules are shared infrastructure. A new gadget should still add or refine `ToolDefinition` metadata rather than branching inside a helper.

---

## The single-entrypoint invariant

Adding a gadget requires **zero edits** to:

- `src/gadgets/shared/cliCommandFactory.ts`
- `src/gadgets/shared/cli/*.ts`
- `src/gadgets/shared/manifestGenerator.ts`
- `src/gadgets/shared/errorEnvelope.ts`
- `src/backends/shared/nativeToolPrompts.ts`

If you find yourself opening one of those files, stop — the right fix is almost always to attach more metadata to your ToolDefinition, or to propose a spec for a new shared capability. A per-gadget branch in shared infrastructure is a red flag.

---

## Mistyped flags → "did you mean"

The factory intercepts oclif's `NonExistentFlagsError`, runs a Levenshtein match against every declared canonical flag name + alias, and surfaces the closest canonical name as `error.hint`. No gadget work required — just declare your flags truthfully.

Two tuning constants live in `src/gadgets/shared/cli/parseErrors.ts`: `MAX_FLAG_SUGGESTION_DISTANCE` (default 2) and `MAX_FLAG_SUGGESTION_RATIO` (default 0.4). Wildly-off mistypes get no suggestion rather than a misleading one.

---

## Reference: `createPRReviewDef`

`src/gadgets/github/definitions.ts` is the reference gadget for spec 014 — it carries `cliAliases: ['comment']` on `comments`, `fileInputAlternatives` entries for `--body-file` (long review summaries, reply bodies, and comment updates) and `--comments-file` (JSON inline comments), and a well-formed `examples` block. Read it before you add a new gadget with array-of-object parameters.

## Reference: `ReportFriction`

`ReportFriction` is the PM-scoped reference for a non-blocking sidecar/outbox command. Its definition lives in `src/gadgets/pm/definitions.ts`; the implementation lives in `src/gadgets/pm/core/reportFriction.ts`.

Agents invoke it through:

```bash
cascade-tools pm report-friction \
  --summary "Missing setup hint" \
  --category tooling \
  --severity medium \
  --details-file -
```

`--details-file -` reads Markdown details from stdin. The command writes a queued event to `CASCADE_FRICTION_SIDECAR_PATH` before attempting PM materialization, then returns `filed`, `queued_for_retry`, or `queued_slot_missing`. This is why the feature can report friction without granting broad PM write access and without failing the main run when PM filing is unavailable.
