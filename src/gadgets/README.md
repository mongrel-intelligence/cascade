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
