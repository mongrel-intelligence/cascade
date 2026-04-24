---
id: 014
slug: cascade-tools-agent-ergonomics
level: spec
title: cascade-tools agent ergonomics — truthful prompts, runnable help, actionable errors
created: 2026-04-24
status: draft
---

# 014: cascade-tools agent ergonomics — truthful prompts, runnable help, actionable errors

## Problem & Motivation

`cascade-tools` is the CLI surface LLM agents use to interact with PMs, SCMs, and their own session — it is *the* I/O boundary between every review / implementation / backlog agent and the outside world. Its ergonomics for an LLM reader are currently below the bar set by Anthropic's own tool-use guidance: unclear parameter shape hints, help text without runnable examples, and error messages that don't give the model enough information to self-correct.

The failure mode is observable. In prod run `5d993b04-6e05-4ae1-b7de-8c274cf3496b` (review agent, PR #1188), the agent wasted roughly one third of its 7m42s wall clock — ~2½ minutes — struggling with `cascade-tools scm create-pr-review`. Three compounding failures:

1. The **agent system prompt** rendered the `comments` array parameter as `[--comment <string> (repeatable)]` — singular name, "string" type, "repeatable" semantics. The CLI in reality expects `--comments '<json array>'` — plural, JSON-encoded, single invocation. The agent followed the prompt literally and tripped over every dimension of the mismatch.
2. The `--help` output contained no runnable JSON example. The agent ran `--help` four times and `cat`ted five source files trying to reverse-engineer the shape.
3. The CLI's error on malformed JSON was `--comments must be valid JSON`. No offending input, no shape hint, no example, no pointer to an escape hatch. The agent improvised and ultimately dropped the inline comment entirely, posting a body-only review.

The root cause of (1) is the manifest renderer that strips trailing `s` and hard-codes `<string> (repeatable)` for every array parameter regardless of its item type. The root causes of (2) and (3) are in the shared oclif command factory. Because these surfaces are shared, the same class of defect affects every gadget with an array-of-object, object, or enum parameter — not just `create-pr-review`. The spec addresses the systemic failure: one set of fixes in the shared infrastructure so every cascade-tools command becomes legibly usable by an LLM agent.

The intended outcome is that a review agent (and every other agent) can read `cascade-tools <cmd> --help`, read its system prompt's tool guidance, and — when it errors — read the error message, and in each case have everything it needs to produce a correct invocation on the next attempt.

---

## Goals

1. Every cascade-tools command documented in the agent system prompt uses the **actual** flag names and the **actual** input shape expected by the CLI — no `s`-stripping, no lossy "string" coercion for JSON inputs.
2. Every parameter that carries a non-trivial shape (object, array-of-object, enum) includes a concrete, runnable example inline in both the agent's system prompt and `--help`.
3. Every CLI failure — flag parse error, JSON parse error, validation error, runtime gadget error — emits a single structured error envelope on stdout that names the offending flag, shows a truncated view of the offending input, states the expected shape, and (when available) points at an escape hatch.
4. Mistyped flag names produce a "did you mean" suggestion automatically, not a bare "unknown flag" rejection.
5. The `cascade-tools scm create-pr-review` command specifically accepts `--comment` as an alias for `--comments` so the muscle-memory mistake from run 5d993b04 resolves without a code change next time.
6. JSON-shaped flags have a file-input escape hatch available when declared on the gadget (the same `--X-file` pattern already used for long string bodies).
7. Adding a new gadget requires only declarative metadata on its tool definition (param types, examples, aliases, file alternatives) — no edits to the shared factory, the manifest renderer, or the prompt builder.

---

## Non-goals

- The `cascade` dashboard CLI (different binary, different audience). This spec is exclusively about `cascade-tools`.
- Agent prompt templates themselves (the per-agent `.eta` files). Only the tool-guidance section that describes cascade-tools is in scope.
- Trigger/router logic, worker orchestration, PM webhook dispatch.
- Full JSON-schema validation of flag payloads. We catch parse errors and shape-level malformedness; we do not re-validate each object against the gadget's runtime contract here.
- Switching CLI frameworks (oclif stays).
- The post-success `Failed to delete progress comment` 404 warning observed in run 5d993b04 — separate bug, out of scope.

---

## Constraints

- **Backwards compatibility for CLI callers.** The manual-runner scripts, retry path, and any shell aliases that call cascade-tools with current flag names must continue to work. New aliases are additive only.
- **Prompt token budget.** Per-param example lines expand the system prompt. The expansion must be bounded and proportional — only array-of-object / object / enum params that have an example pay the cost; primitive params stay one-line. Rough ceiling: ≤80 additional tokens per affected param.
- **Zero network dependency for help/error paths.** `--help` and argument-parse errors must not touch the network.
- **Single-entrypoint invariant.** Fixes live in the shared factory + manifest generator + prompt builder. Per-gadget changes are limited to declarative metadata (new alias, new file-input entry, new example). No per-gadget code branches in shared infrastructure.
- **oclif version.** Stays on current major (v4.x).
- **Error envelope stability.** Once defined, the stdout-JSON error envelope shape becomes part of the contract agents rely on. Changing field names later is a breaking change.

---

## User stories / Requirements

**As a review agent**, when I run `cascade-tools scm create-pr-review --help`, I see a runnable example that includes the inline-comments JSON shape, so I can produce a valid invocation without reading source files.

**As a review agent**, when I accidentally type `--comment` (singular) instead of `--comments`, the CLI accepts it, so my first attempt succeeds.

**As any cascade-tools-consuming agent**, when I produce a malformed JSON payload, the error message tells me (a) which flag was wrong, (b) a fragment of what I actually passed, (c) the shape the CLI expected, and (d) whether a `--X-file` path exists — so I can self-correct on the next call.

**As any cascade-tools-consuming agent**, when I mistype a flag name close to a real one, the CLI suggests the intended flag.

**As a gadget author**, when I add a new tool, I declare aliases, examples, and file alternatives on the tool definition; I do not edit the shared factory, the manifest renderer, or the prompt builder.

**As a human operator**, when a cascade-tools command fails in my terminal, I can still read a one-line prose summary of the error; I am not forced to pipe through `jq`.

---

## Research Notes

- **Anthropic tool-use guidance** recommends per-parameter format descriptions, `enum` for constrained values, and **examples inline with the schema** to show Claude "concrete patterns for well-formed tool calls" — explicitly addresses the gap identified here.
- **Anthropic error-handling guidance** for tool results: return a clear informative error with enough detail for Claude to either retry correctly or inform the user. Generic "must be valid JSON" fails this bar.
- **LLM self-correction literature** (2026) emphasizes that self-correction works when the model is given specific, localized feedback about the flaw — not brute-force retry. Error messages that name the flaw explicitly are load-bearing.
- **oclif v4** supports `aliases: string[]` on flags natively; no custom alias machinery is needed. It does **not** implement "did you mean" for flag names (only for commands) — that's DIY. A tiny `fastest-levenshtein` scorer covers it.
- **Salesforce CLI / Heroku CLI** (both oclif-based) use `summary` (short) + `description` (long) on flags for richer help. We currently use only `description`.

Sources:
- [Anthropic — Tool use](https://docs.anthropic.com/en/docs/tool-use)
- [Anthropic — Implement tool use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use)
- [oclif — Command flags](https://oclif.io/docs/flags/)
- [oclif issue #66 — "did you mean" for flag names](https://github.com/oclif/oclif/issues/66)
- [LLM-as-runtime-error-handler — self-healing pathway](https://arxiv.org/html/2408.01055v1)
- [Error handling strategies in LLM tool execution](https://apxml.com/courses/building-advanced-llm-agent-tools/chapter-1-llm-agent-tooling-foundations/tool-error-handling)

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|------|--------|----------|--------|
| [oclif core](https://oclif.io/docs/flags/) (already in use) | CLI framework, flag parsing, help generation | **Keep** | Already committed. Native `aliases`, `summary`, `description`, `examples` cover all ergonomics needs. |
| [fastest-levenshtein](https://github.com/ka-weihe/fastest-levenshtein) | "Did you mean" suggestion on mistyped flags | **Use** | ~1kB, zero dependencies, fastest JS implementation. Cleaner than hand-rolling for a durable feature. Adopted per Phase 4 decision. |
| [zod](https://zod.dev) (already in use elsewhere) | Runtime shape validation of parsed JSON payloads | **Skip for this spec** | Adds boundary validation cost. Non-goal: payload validation beyond parse-correctness. Defer to a later spec if agent-side shape errors become a pattern. |
| [commander](https://github.com/tj/commander.js) / [citty](https://github.com/unjs/citty) | Alternative CLI frameworks | **Skip** | Switching frameworks is out of scope and unnecessary — oclif covers every requirement. |

---

## Strategic decisions

1. **Unify error output on stdout JSON, mirror a one-line summary to stderr.** *(Decision in Phase 4.)* Every cascade-tools failure — flag parse, JSON parse, auth, runtime — emits a structured envelope on stdout: `{"success": false, "error": {"type", "flag?", "message", "got?", "expected?", "hint?", "example?"}}`. A short prose summary also goes to stderr for human operators. Agents get one surface; humans keep readable errors. The envelope schema becomes part of the cascade-tools contract.

2. **Fuzzy flag suggestion via `fastest-levenshtein`, not hand-rolled.** *(Decision in Phase 4.)* When a flag is rejected as unknown, compute Levenshtein distance against every declared flag name (plus aliases) and include a "did you mean" hint when the closest match is within a reasonable threshold. Small dependency, durable feature.

3. **File-input escape hatches stay opt-in.** *(Decision in Phase 4.)* Gadgets declare `--X-file` alternatives explicitly, matching today's pattern. `create-pr-review` gains `--comments-file` as part of this spec; other gadgets opt in as needed. Avoids flag clutter.

4. **One-line inline example per array-of-object / object / enum param in both help and system prompt.** *(Decision in Phase 4.)* Pulled from the tool definition's existing `examples` block (first example where the param is populated), not from a new schema field. Proportional prompt cost, maximum clarity at point of use.

5. **Declarative aliases on the tool definition, not per-command hand-coding.** Aliases travel with the gadget's definition; the factory threads them into oclif. `cliAliases: ['comment']` on `createPRReviewDef.parameters.comments` is the reference case.

6. **System-prompt rendering becomes a pure function of the manifest.** The manifest carries everything the prompt renderer needs (type, items, aliases, one example). No per-gadget logic in the renderer. The renderer is the source of truth for how agents are told to use the CLI; fixing it once fixes every consumer.

7. **Help and prompt draw from a single metadata source.** What `--help` shows and what the agent sees in its system prompt derive from the same `ToolDefinition`. Divergence is a design bug, not a feature.

8. **No per-parameter runtime validation beyond JSON.parse.** Out of scope per non-goals. Malformed payloads that parse but don't match the expected shape are caught downstream by the gadget or the remote API; the CLI's job is parse-correctness and clear errors.

---

## Acceptance Criteria (outcome-level)

1. Running `cascade-tools scm create-pr-review --comment '[{"path":"a","line":1,"body":"b"}]' …` succeeds in parsing and passes the inline comments through to the gadget; `--comments` with the same value produces identical behavior.
2. Running `cascade-tools scm create-pr-review --help` displays an `EXAMPLES` section that includes a copy-pasteable invocation with a well-formed `--comments` JSON array.
3. Passing malformed JSON to any cascade-tools flag produces a structured error on stdout naming the flag, showing the first ~80 chars of the offending input, stating the expected shape, and — when a file-input alternative exists — pointing at it. A prose summary is also written to stderr.
4. The structured error envelope on stdout has a stable, documented schema (fields: `type`, `flag`, `message`, `got`, `expected`, `hint`, `example`). Every CLI failure path populates it — flag parse, JSON parse, required-missing, enum-mismatch, auth, runtime.
5. Mistyping a flag name close to a real one (e.g. `--comnent`, `--body` typoed as `--bdy`) produces an error that includes "Did you mean `--<correct>`?" derived from Levenshtein-closest match against the command's declared flags and aliases.
6. The agent-facing tool manifest surfaced in the system prompt renders every array-of-object parameter with its actual plural name (no `s`-stripping), marks it as a JSON value (not "repeatable string"), and includes a one-line runnable example pulled from the tool definition.
7. Running the full test suite after the changes shows no regressions in existing cascade-tools behavior: primitive-array params (e.g. label IDs) still render as repeatable strings in the prompt, string params still render without examples, and existing CLI invocations continue to succeed.
8. Adding a new gadget with an array-of-object parameter — declaring only `type`, `items`, `describe`, and an `examples` block — produces correct prompt text, correct `--help`, and correct error messages without editing the shared factory, the manifest generator, or the prompt builder.
9. `cascade-tools scm create-pr-review` gains `--comments-file <path>` (accepts JSON file contents, `-` for stdin); both `--help` and the agent prompt reference it as an alternative for long payloads.
10. A human running a failing cascade-tools command in a terminal reads a short prose summary on stderr without needing to parse JSON. `[manual]` — verification is whether the stderr text is readable, which is a subjective-ergonomics judgment best sanity-checked by a human eye.

---

## Documentation Impact (high-level)

- `src/gadgets/README.md` (new) — authoring guide for cascade-tools gadgets: declarative metadata available (`cliAliases`, `fileInputAlternatives`, `examples`), the error-envelope contract, and the single-entrypoint invariant that no gadget edits the shared renderer/factory/prompt builder.
- `src/integrations/README.md` — brief cross-reference from the PM-provider section to the new gadgets README (PM provider authors hit cascade-tools through their gadget surface).
- `CHANGELOG.md` — entries for each plan that merges.
- `docs/specs/` — this file, once merged, moves from `014-cascade-tools-agent-ergonomics.md` to `.done` on completion.
- No `CLAUDE.md` entry — the authoring rule is narrow to gadget authors and has a clear home in `src/gadgets/README.md`. No changes to top-level `README.md` either — cascade-tools is internal tooling for agents, not a product surface.

---

## Out of Scope

- The `cascade` dashboard CLI binary and its commands (runs/projects/agents/etc.).
- Agent prompt template files (`src/agents/prompts/templates/*.eta`) beyond the tool-guidance rendering.
- The `Failed to delete progress comment after agent success` 404 warning observed in run 5d993b04 — separate bug.
- Runtime shape validation of parsed JSON payloads beyond JSON.parse success.
- Switching CLI frameworks away from oclif.
- Rolling out `--X-file` alternatives to every gadget preemptively — opt-in per gadget.
- PM provider wizard UX, webhook adapters, and other non-cascade-tools surfaces.
- Backwards-incompatible renames of existing cascade-tools flag names (aliases are additive only).
