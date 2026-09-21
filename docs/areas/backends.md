# Engine backends

**Applies to:** `src/backends/**`

Mechanism lives in [05-engine-backends](../architecture/05-engine-backends.md) and [`src/backends/README.md`](../../src/backends/README.md); the end-to-end recipe for a new engine is [adding-engines](../adding-engines.md).

- Follow the `adding-engines` checklist end to end — the engine-contract and env-filter tests are required, not optional.
- Engines deliberately suppress native instruction-file discovery (`--ignore-user-config --ignore-rules` for Codex, `instructions: []` for OpenCode, a plain `systemPrompt` string with no `settingSources` for the Claude Agent SDK). The repo's `CLAUDE.md` reaches agents only through `readContextFiles` → [agents](./agents.md). Do not re-enable discovery without measuring the context cost.
- Bumping `@openai/codex` in `Dockerfile.worker` means regenerating `tests/fixtures/codex/<version>/` (protocol schema + a recorded exec stream): the event-schema test reads the pin and fails without them, and the image build re-parses CASCADE's argv with the new CLI (`grammarSmokeCli`). Check the CLI's config keys too — `web_search` and hooks have both changed shape across releases.
- Secrets reach engine subprocesses only through `secretBuilder` / `secretOrchestrator` and the env allowlist in `src/backends/shared/envFilter.ts`; never pass `process.env` through.
- Subscription auth files (`~/.claude.json`, `~/.codex/auth.json`) are written per run and cleaned up in `afterExecute`; Codex token refreshes are persisted back to the `CODEX_AUTH_JSON` credential.
- For native-tool engines, the system prompt is `NATIVE_TOOL_EXECUTION_RULES` + agent template + tool guidance (`src/backends/shared/nativeToolPrompts.ts`); `cascade-tools` shell-safety rules belong there, not in per-engine code. LLMist receives the agent system prompt directly.
