# Agent Engines

CASCADE runs coding agents through a shared execution lifecycle and a pluggable engine registry.

## Core pieces

- `types.ts`: canonical engine contracts (`AgentEngine`, `AgentEngineDefinition`, `AgentExecutionPlan`)
- `catalog.ts`: static engine definitions with `archetype` field (`sdk` or `native-tool`)
- `registry.ts`: runtime engine registry (`registerEngine`, `getEngine`, `isNativeToolEngine`)
- `bootstrap.ts`: built-in engine registration (also registers settings schemas)
- `adapter.ts`: shared lifecycle around repo setup, prompts, progress, secrets, run tracking, and post-processing
- `shared/NativeToolEngine.ts`: abstract base class for subprocess-based engines (Claude Code, Codex, OpenCode)
- `llmist/`, `claude-code/`, `codex/`, `opencode/`: engine-specific implementations

## Archetypes

Every engine declares an `archetype` in its `AgentEngineDefinition`:

- **`native-tool`** — subprocess-based CLI tools (Claude Code, Codex, OpenCode). Extend `NativeToolEngine` from `shared/NativeToolEngine.ts`. The base class provides shared env-building, `supportsAgentType()`, `resolveModel()` delegation, and context file cleanup.
- **`sdk`** — in-process SDK integrations (LLMist). Implement `AgentEngine` directly; no base class is used.

## To add a new engine

See [`docs/adding-engines.md`](../../docs/adding-engines.md) for the full step-by-step guide, including archetype selection, env filtering, settings schemas, model resolution, registration, and testing.

At a high level:

1. Choose archetype: extend `NativeToolEngine` for subprocess CLIs, implement `AgentEngine` directly for in-process SDKs.
2. Create `src/backends/<engine-name>/` with `index.ts`, `env.ts`, `models.ts`, and optionally `settings.ts`.
3. Add an `AgentEngineDefinition` with the `archetype` field to `catalog.ts`.
4. Register the engine (and its settings schema) in `bootstrap.ts`.

The rest of the product consumes engine metadata dynamically via `getEngineCatalog()` — no branching on engine names required.
