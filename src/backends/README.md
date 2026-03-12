# Agent Engines

CASCADE runs coding agents through a shared execution lifecycle and a pluggable engine registry.

Core pieces:

- `types.ts`: canonical engine contracts
- `registry.ts`: runtime engine registry and catalog source
- `bootstrap.ts`: built-in engine registration
- `adapter.ts`: shared lifecycle around repo setup, prompts, progress, secrets, run tracking, and post-processing
- `llmist/`, `claude-code/`, and `codex/`: engine-specific adapters

To add a new engine:

1. Implement `AgentEngine` with a stable `definition.id`.
2. Register it through the engine registry.
3. Keep orchestration concerns in the shared adapter unless they are truly engine-specific.

The rest of the product should consume engine metadata dynamically rather than branching on engine names.
