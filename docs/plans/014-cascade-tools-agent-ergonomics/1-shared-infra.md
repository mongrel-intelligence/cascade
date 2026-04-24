---
id: 014
slug: cascade-tools-agent-ergonomics
plan: 1
plan_slug: shared-infra
level: plan
parent_spec: docs/specs/014-cascade-tools-agent-ergonomics.md
depends_on: []
status: pending
---

# 014/1: cascade-tools shared infra — truthful prompts, structured errors, fuzzy flags, help examples

> Part 1 of 2 in the 014-cascade-tools-agent-ergonomics plan. See [parent spec](../../specs/014-cascade-tools-agent-ergonomics.md).

## Summary

Ships the root-cause fix from prod run `5d993b04-6e05-4ae1-b7de-8c274cf3496b` and all the shared infrastructure that supports it. Three surfaces change: (a) the agent-facing system-prompt renderer stops lying about array parameter names and shapes; (b) the oclif command factory gains flag aliases, JSON parsing for array-of-object flags, a structured error envelope, fuzzy flag suggestion, and help examples; (c) the tool-manifest generator threads the new metadata through. Contracts widen: `ParameterDefinition` gains `cliAliases?`, `FileInputAlternative` gains `parseAs?`, and `ToolManifest` parameters carry `items?` / `aliases?` / `example?`.

Zero production gadget definitions change here. Every new code path is exercised by a minimal fake `ToolDefinition` fixture so the infra is provably complete before plan 2 adopts it. The prompt-renderer fix *does* apply to every gadget immediately — an agent querying `cascade-tools` after this plan merges sees truthful tool guidance across the board, even before plan 2.

**Components delivered:**
- `src/gadgets/shared/toolDefinition.ts` — widened types.
- `src/agents/contracts/index.ts` — widened `ToolManifest`.
- `src/gadgets/shared/errorEnvelope.ts` (new) — `CliErrorEnvelope` type + `emitCliError()` helper.
- `src/gadgets/shared/cliCommandFactory.ts` — aliases, JSON parse, error envelope integration, fuzzy suggestion, help examples.
- `src/gadgets/shared/manifestGenerator.ts` — thread items/aliases/example.
- `src/backends/shared/nativeToolPrompts.ts` — rewrite array branch in `formatParam`, render aliases + example inline.
- `src/gadgets/README.md` (new) — authoring guide.
- `src/integrations/README.md` — one-line cross-reference to gadgets README.
- `CHANGELOG.md` — entry.
- `package.json` + lockfile — add `fastest-levenshtein`.
- Tests (≈25) across `tests/unit/gadgets/shared/` + `tests/unit/backends/`.

**Deferred to later plans in this spec:**
- Plan 2 applies the pattern to `createPRReviewDef` (adds `cliAliases: ['comment']`, `fileInputAlternatives` for `--comments-file`, integration smoke test).

---

## Spec ACs satisfied by this plan

- Spec AC #2 (`create-pr-review --help` has EXAMPLES section) — **full** (the factory wiring that renders `def.examples` into oclif help lands here; `createPRReviewDef.examples` already exists today).
- Spec AC #3 (structured stdout error with flag/got/expected/hint) — **full**.
- Spec AC #4 (stable envelope schema across every failure path) — **full**.
- Spec AC #5 ("did you mean" flag suggestions) — **full**.
- Spec AC #6 (truthful system-prompt rendering, no `s`-stripping, JSON marker) — **full**.
- Spec AC #7 (no regressions on primitive-array gadgets) — **full**.
- Spec AC #8 (new gadget = declarative metadata only) — **partial** — proven here via a fake test gadget; plan 2 proves it with a production gadget by not touching any shared file.
- Spec AC #10 [manual] (stderr prose readable) — **full** (error envelope emits prose summary to stderr).

---

## Depends On

- No other plan (layer 0).
- Existing code: oclif v4.x, `@oclif/core` `Flags.*` supporting `aliases`, the current `ToolDefinition`/`ToolManifest` shapes, existing `createPRReviewDef.examples` block.

---

## Detailed Task List (TDD)

### 1. Widen contracts

**Tests first** (`tests/unit/gadgets/shared/manifestGenerator.test.ts`, new file):

- `threads items from array parameter into manifest` — unit — given a `ToolDefinition` with `parameters.x = { type: 'array', items: 'object', describe: 'x' }`, `generateToolManifest(def).parameters.x.items` equals `'object'`. Expected red: `TypeError: generated manifest parameter missing 'items' field` (or equivalent once the field is absent).
- `threads cliAliases into manifest as aliases` — unit — param with `cliAliases: ['comment']` produces manifest entry with `aliases: ['comment']`. Expected red: `expected 'aliases' to equal ['comment'], received undefined`.
- `threads first matching example param value into manifest as example` — unit — def with `examples: [{ params: { comments: [{path:'a',line:1,body:'b'}] } }]` produces `parameters.comments.example` deep-equal to that array. Expected red: `expected parameter to have 'example' property`.
- `primitive-array parameter still produces items:'string'` — unit — `{type:'array', items:'string'}` manifest round-trips. Expected red: `expected 'items' to equal 'string', received undefined` (when we haven't wired it yet).
- `gadgetOnly params are still excluded` — unit — regression guard. Expected red: n/a (existing behavior; this test locks it).

**Implementation** (`src/gadgets/shared/toolDefinition.ts`):
- Add `readonly cliAliases?: readonly string[]` to `ParameterDefinition` discriminated union (all branches inherit via shared base).
- Add optional `readonly parseAs?: 'string' | 'json'` to `FileInputAlternative` (default `'string'`).

**Implementation** (`src/agents/contracts/index.ts`):
- Widen `ToolManifest.parameters` entry shape to include optional `items?: string`, `aliases?: readonly string[]`, `example?: unknown`.

**Implementation** (`src/gadgets/shared/manifestGenerator.ts`):
- `buildManifestParam`: when `def.type === 'array'`, copy `items` to entry. Copy `def.cliAliases` to `entry.aliases` when present. In `generateToolManifest`, after building each entry, scan `def.examples ?? []` in order and take the **first** example whose `params[name]` is defined; attach as `entry.example`.

### 2. Error envelope

**Tests first** (`tests/unit/gadgets/shared/errorEnvelope.test.ts`, new file):

- `emits stable JSON shape to stdout` — unit — `emitCliError({type:'json-parse', flag:'comments', got:'[{\'a\':1}]', expected:'[{"path":…}]', hint:'use --comments-file'})` writes one line of JSON to the captured stdout containing exactly the keys `success=false`, `error.type`, `error.flag`, `error.message`, `error.got`, `error.expected`, `error.hint`. Expected red: `TypeError: emitCliError is not a function` (module doesn't exist yet).
- `mirrors prose summary to stderr` — unit — same invocation writes ≤120 chars of prose (no ANSI) to stderr including the flag name. Expected red: `expected stderr length > 0, received 0`.
- `truncates 'got' to ~80 chars with ellipsis` — unit — passing a 500-char input yields `error.got` length ≤ 83 ending in `...`. Expected red: `expected 83, received 500`.
- `example field optional; omitted from output when absent` — unit — when no `example` provided, the JSON does not include the key. Expected red: `expected key 'example' to be absent`.
- `exits with code 1` — unit — spies on `process.exit` and asserts code 1. Expected red: `expected process.exit called with 1, received 0` (or not called).

**Implementation** (`src/gadgets/shared/errorEnvelope.ts`, new):
- Export interface `CliErrorEnvelope` with fields `{ type: 'flag-parse' | 'json-parse' | 'missing-required' | 'enum-mismatch' | 'unknown-flag' | 'auth' | 'runtime'; flag?: string; message: string; got?: string; expected?: string; hint?: string; example?: string }`.
- Export `emitCliError(opts: CliErrorEnvelope & { stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream; exit?: (code: number) => never }): never` — writes `JSON.stringify({ success: false, error: <envelope, with got truncated> })` + `\n` to stdout, writes a one-line prose summary like `--<flag>: <type> — <message>` to stderr, calls `exit(1)`. Streams/exit are injectable for testability; default to `process.stdout` / `process.stderr` / `process.exit`.
- Helper `truncateGot(s: string, max = 80): string` used internally.

### 3. Factory: flag aliases + help examples + JSON parse for array-of-object

**Tests first** (`tests/unit/gadgets/shared/cliCommandFactory.test.ts`, new file):

- `applies cliAliases to generated oclif flag` — unit — builds a Command class from a fake def with `{type:'string', cliAliases:['x-alias']}` on a flag named `x`; introspects `FactoryCommand.flags.x.aliases` and asserts `['x-alias']`. Expected red: `expected ['x-alias'], received undefined`.
- `invocation with alias flag resolves to canonical param name` — unit — spawns Command with args `['--x-alias', 'v']`, coreFn receives `{x:'v'}`. Expected red: alias not recognized, oclif throws "Unknown flag --x-alias".
- `wires def.examples onto FactoryCommand.examples` — unit — static `.examples` array non-empty; each entry is a string containing the command's kebab name and serialized params. Expected red: `expected FactoryCommand.examples to have length > 0, received undefined`.
- `array + items:'object' flag value parses as JSON` — unit — coreFn receives parsed array when flag value is `'[{"k":"v"}]'`. Expected red: `expected array, received string`.
- `array + items:'object' with malformed JSON emits envelope via emitCliError` — unit — mocks `emitCliError`; passes `"[{'k':'v'}]"` (single-quoted keys); asserts `emitCliError` called once with `type:'json-parse'`, `flag:'<name>'`, `got` present, `expected` present derived from the param's `example`. Expected red: `expected emitCliError to be called, received 0 calls`.
- `array + items:'string' stays multiple:true (no regression)` — unit — coreFn receives string array on `['--labels','a','--labels','b']`. Expected red: n/a — locks current behavior.
- `fileInputAlternatives with parseAs:'json' parses file contents` — unit — stubs filesystem; flag value from file is JSON-parsed before handing to coreFn. Expected red: `expected array, received string`.
- `fileInputAlternatives with parseAs:'json' malformed JSON emits envelope` — unit — same pattern as above but via the file flag; hint should still reference `--X-file` where applicable. Expected red: `expected emitCliError to be called`.
- `required-missing uses emitCliError with type:'missing-required'` — unit — locks existing behavior under the new envelope.

**Implementation** (`src/gadgets/shared/cliCommandFactory.ts`):
- `buildOclifFlag`: when `def.cliAliases?.length > 0`, pass `aliases: [...def.cliAliases]` into `Flags.*` call for every type branch. oclif v4 accepts `aliases: string[]` on string/integer/boolean/enum flags.
- New branch in `resolveDirectParams`: when `paramDef.type === 'array' && paramDef.items === 'object'`, read raw flag value (which oclif returns as `string[]` due to `multiple:true` — treat length-1 as the JSON blob; length>1 is invalid and emits a runtime envelope `type:'flag-parse'`), `JSON.parse` it, emit envelope with `type:'json-parse'` on failure including `got` (truncated) and `expected` (derived from `paramDef.example`-via-manifest OR from `paramDef.describe`).
- `resolveFileInputParam`: when the param's `FileInputAlternative.parseAs === 'json'`, `JSON.parse` the file contents before assignment; emit envelope on parse failure with hint pointing back to stdin shape.
- `createCLICommand` return class: add `static override examples = buildExamplesForOclif(def)` where `buildExamplesForOclif` renders each `def.examples[i]` as a single-line shell invocation using the derived kebab command + flag-flattened params (reuse `deriveCLICommand` from `manifestGenerator`). Array/object params in examples are JSON-serialized and single-quoted for shell.
- Replace the two existing `command.error(...)` sites with `emitCliError(...)` calls carrying the appropriate `type`/`flag`/`got`/`expected`/`hint`.
- The gadget runtime-error `catch` block (currently `{success:false,error:message}`) stays on stdout but routes through the same envelope shape with `type:'runtime'`.

### 4. Factory: fuzzy flag suggestion

**Tests first** (`tests/unit/gadgets/shared/cliCommandFactory.test.ts`, extend):

- `unknown flag close to real one suggests correction` — unit — def with flag `comments`; invoked with `--comnent`; emitCliError called with `type:'unknown-flag'`, `hint` containing `did you mean --comments?`. Expected red: `expected hint to contain 'did you mean', received undefined`.
- `unknown flag not close to any real one emits envelope without suggestion` — unit — invoked with `--zzzz`; envelope has no `hint` or hint without "did you mean". Expected red: n/a — locks that we don't suggest wildly wrong matches.
- `suggestion considers declared aliases too` — unit — def flag `comments` with `cliAliases:['comment']`; invoked with `--coment` (closer to alias). Suggestion points to canonical `--comments`, not the alias (to canonical-ize). Expected red: `expected suggestion '--comments', received '--comment'`.

**Implementation** (`src/gadgets/shared/cliCommandFactory.ts`):
- Override oclif's default "unknown flag" error path. The cleanest hook: wrap `this.parse(FactoryCommand)` in try/catch; catch oclif's `ParserError` with `message` starting with `Nonexistent flag`, extract the offending token, compute Levenshtein distance against all declared flag names + `fileInputAlternatives.fileFlag` + canonical forms of aliases. If the min distance is ≤ 2 (tunable constant) and ≤ 40% of target length, include `hint: 'did you mean --<closest>?'` — always canonical name, never an alias.
- Same intercept path emits envelopes for other oclif parser errors (`Missing required flag`, `Expected --x=…` etc.) with `type:'missing-required'` / `'flag-parse'`.
- Import from `fastest-levenshtein`: `import { distance } from 'fastest-levenshtein'`.

### 5. Prompt renderer

**Tests first** (`tests/unit/backends/shared-nativeToolPrompts.test.ts`, extend existing file):

- `array of object renders with plural name and JSON shape` — unit — manifest with `parameters.comments = {type:'array', items:'object', description:'…'}`; `buildToolGuidance` output contains `--comments '<json>'`, does NOT contain `--comment ` (trailing space — rules out both singular and "comment '"). Expected red: `expected to contain --comments, received --comment (repeatable)`.
- `array of object with example renders one-line example comment` — unit — manifest with `parameters.comments.example = [{path:'src/x',line:1,body:'y'}]`; output contains `example: --comments '[{"path":"src/x","line":1,"body":"y"}]'`. Expected red: `expected output to contain 'example:'`.
- `array of object with aliases renders them next to the flag` — unit — `parameters.comments.aliases = ['comment']`; output contains `--comments|--comment '<json>'`. Expected red: `expected output to contain '|'`.
- `array of string stays repeatable and keeps plural name` — unit — `parameters.labels = {type:'array', items:'string'}`; output contains `--labels <string> (repeatable)`, NOT `--label ` (regression guard for the `s`-stripping bug). Expected red: `expected --labels, received --label (repeatable)`.
- `object param renders with JSON shape + example` — unit — covers object-not-array case. Expected red: current code doesn't special-case object; test locks new behavior.
- `string param unchanged` — unit — regression guard for primitive shape. Expected red: n/a.
- `required vs optional bracket handling preserved` — unit — `[...]` around optional, bare for required. Expected red: n/a.

**Implementation** (`src/backends/shared/nativeToolPrompts.ts`):
- Rewrite `formatParam` array branch:
  - If `schema.items === 'object'`: emit `<req|opt> --{key}[|--{alias}...] '<json>'` using the **actual** key (no `s`-strip). Append `  # ${schema.description}` on the same line if present. Append on a new indented line `  # example: --${key} '<JSON.stringify(schema.example)>'` when `schema.example !== undefined`.
  - If `schema.items === 'string'` (primitive array): keep current `--{key} <string> (repeatable)` semantics but use the **actual** key (no `s`-strip).
- Add an `object` branch mirroring the array-of-object path (single JSON blob, not an array).
- `formatParam` signature updated to accept the widened manifest entry type; render aliases via `(schema.aliases ?? []).map(a => \`|--${a}\`).join('')` in the flag header.

### 6. Add fastest-levenshtein dependency

**Tests first**: n/a (dep-only change, exercised by fuzzy-flag tests in step 4).

**Implementation**:
- `package.json`: add `"fastest-levenshtein": "^1.0.16"` to `dependencies`.
- Run `npm install` locally to update the lockfile.

### 7. Docs

**Implementation** (`src/gadgets/README.md`, new):
- ~60-line authoring guide: the three declarative metadata fields (`cliAliases`, `fileInputAlternatives`, `examples`), the error envelope contract, the single-entrypoint invariant (no gadget edits the shared renderer/factory/prompt builder), a short worked example using a simple `PostCommentDef`-style gadget.

**Implementation** (`src/integrations/README.md`):
- Add a single paragraph at the top referencing `src/gadgets/README.md` for cascade-tools gadget authoring (since PM providers also register gadgets).

**Implementation** (`CHANGELOG.md`):
- Entry under the next unreleased version: "cascade-tools: system-prompt renderer now tells the truth about every parameter's shape; CLI failures emit a structured `{success:false,error:{…}}` envelope on stdout; unknown flags receive 'did you mean' suggestions; `--help` shows runnable examples from the tool definition."

---

## Test Plan

### Unit tests
- [ ] `tests/unit/gadgets/shared/manifestGenerator.test.ts` (new): 5 tests — items threading, cliAliases threading, example extraction, primitive-array regression, gadgetOnly exclusion regression.
- [ ] `tests/unit/gadgets/shared/errorEnvelope.test.ts` (new): 5 tests — JSON shape, stderr prose, truncation, optional fields, exit code.
- [ ] `tests/unit/gadgets/shared/cliCommandFactory.test.ts` (new): 10 tests — alias wiring, alias invocation, help examples, JSON parse array-of-object, malformed JSON envelope, primitive array no-regression, file-input JSON parse, file-input bad JSON envelope, missing-required envelope, fuzzy suggestion (3 sub-tests).
- [ ] `tests/unit/backends/shared-nativeToolPrompts.test.ts` (extend): 7 new tests — array-of-object rendering, example line, alias header, primitive-array regression, object rendering, string regression, bracket handling.

### Integration tests
- n/a (no binary smoke in plan 1; plan 2 covers that).

### Acceptance tests
- All per-plan ACs below are auto-verified by the unit suite + lint/typecheck, except AC #9 which is `[manual]`.

---

## Manual Verification

- **AC**: per-plan AC #9 (stderr prose is a readable summary without ANSI garbage or 300-char wrap disasters).
- **Why manual**: readability of a short human-facing error line is a subjective-ergonomics check. Auto-tests can bound length and exclude ANSI escapes, but "is this line something a human operator can scan in one glance?" is not something a test can assert.
- **Verification protocol**:
  1. `npm run build`
  2. `./bin/cascade-tools.js scm create-pr-review --owner x --repo y --prNumber 1 --event COMMENT --body b 1>/tmp/cc.out 2>/tmp/cc.err; cat /tmp/cc.err`
  3. Confirm stderr is a single line, ≤120 characters, no ANSI escape codes, reads as English ("--comments: json-parse — expected [{…}], got '[{…'"), and does NOT include the full JSON envelope.
  4. Repeat with a malformed `--comments` value; confirm the prose includes the flag name and mentions `--comments-file` or "use double quotes" as a hint (if the factory hint path fired). Exact wording need not match a fixed string — readability is the criterion.

---

## Acceptance Criteria (per-plan, testable)

1. `ParameterDefinition` accepts `cliAliases?: readonly string[]`; `FileInputAlternative` accepts `parseAs?: 'string' | 'json'`; `ToolManifest` parameters carry optional `items` / `aliases` / `example`. Type-check passes.
2. `generateToolManifest` threads `items` / `cliAliases → aliases` / first matching `example` into manifest entries.
3. `emitCliError` writes the envelope on stdout, prose on stderr, and exits 1. Envelope fields match the contract.
4. The oclif factory attaches `aliases` when `cliAliases` is declared; alias invocation resolves to the canonical param name.
5. The oclif factory JSON-parses `array + items:'object'` flag values; on parse failure, `emitCliError` is called with `type:'json-parse'` and populated `got` / `expected` / `hint`.
6. The oclif factory renders `def.examples` onto `static examples` for oclif `--help`.
7. The oclif factory intercepts unknown-flag parser errors and suggests the Levenshtein-closest declared canonical flag (distance ≤ 2 AND ≤ 40% of target length).
8. `formatParam` in the prompt renderer uses the actual param name for arrays (no `s`-stripping), distinguishes `items:'object'` from `items:'string'`, renders aliases next to the canonical name, and appends one example line when `schema.example` is present.
9. `[manual]` Running a failing cascade-tools command produces a stderr line a human can read in one glance — verification protocol above.
10. `src/gadgets/README.md` exists and documents the three declarative metadata fields plus the single-entrypoint invariant.
11. `src/integrations/README.md` links to the new gadgets README.
12. `CHANGELOG.md` has an entry for this plan.
13. All new/modified code has corresponding tests.
14. `npm run build` passes.
15. `npm test` passes (all four unit projects).
16. `npm run lint` passes.
17. `npm run typecheck` passes.

**Partial-state criterion**:
- No production gadget has been updated to declare `cliAliases` or `fileInputAlternatives` — plan 1 only adds the capability. The prompt renderer, however, already produces truthful output for every gadget because it consumes the widened manifest (existing `items: 'object'`/`'string'` on each def flows through).

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `src/gadgets/README.md` (new) | Authoring guide — three declarative metadata fields + error envelope contract + single-entrypoint invariant. |
| `src/integrations/README.md` | One-paragraph cross-reference to `src/gadgets/README.md` at the top of the file. |
| `CHANGELOG.md` | Entry describing the new envelope, truthful prompt, help examples, and did-you-mean. |

---

## Out of Scope (this plan)

- Applying the new declarative metadata to any production gadget (plan 2 covers `createPRReviewDef`; future work for others).
- Binary-level integration smoke test (plan 2).
- `CLAUDE.md` update — rejected per Phase 4 decision; authoring rule lives in `src/gadgets/README.md`.
- Full JSON-schema validation of parsed payloads (spec non-goal).
- Dashboard `cascade` CLI (spec non-goal).
- Progress-comment 404 tail bug from run 5d993b04 (spec non-goal).

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 — type widening
- [ ] AC #2 — manifest threading
- [ ] AC #3 — error envelope
- [ ] AC #4 — flag aliases in factory
- [ ] AC #5 — JSON parse for array-of-object
- [ ] AC #6 — examples in oclif help
- [ ] AC #7 — fuzzy suggestion
- [ ] AC #8 — prompt renderer fidelity
- [ ] AC #9 — [manual] stderr prose readable
- [ ] AC #10 — src/gadgets/README.md
- [ ] AC #11 — src/integrations/README.md cross-ref
- [ ] AC #12 — CHANGELOG
- [ ] AC #13 — test coverage
- [ ] AC #14 — build passes
- [ ] AC #15 — tests pass
- [ ] AC #16 — lint passes
- [ ] AC #17 — typecheck passes
