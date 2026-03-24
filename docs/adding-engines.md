# Adding a New Agent Engine

This guide walks through every step required to add a new agent engine to CASCADE — from choosing the right archetype to running your first test. Following this guide, adding a new subprocess-based engine (e.g., Gemini CLI, Kilo Code, Continue.dev) should take a few hours, not days.

---

## 1. Choose an Archetype: `native-tool` vs `sdk`

CASCADE supports two engine archetypes. Choose the one that matches how the tool runs.

### `native-tool` — Subprocess-based CLI tools

Use this when your engine:
- Runs as an **external CLI** process (spawned via `child_process.spawn`)
- Has its own built-in file/bash tools (Read, Write, Edit, Bash, Glob, Grep)
- Communicates by receiving a prompt via stdin/HTTP and streaming output
- Examples: **Claude Code**, **Codex**, **OpenCode**

The `native-tool` archetype provides the `NativeToolEngine` base class (`src/backends/shared/NativeToolEngine.ts`), which handles:
- Shared subprocess environment construction via `buildEngineEnv()`
- `resolveModel()` delegation to your `resolveEngineModel()` implementation
- `supportsAgentType()` returning `true` for all agent types (override if needed)
- `afterExecute()` cleanup for offloaded context files

### `sdk` — In-process SDK integrations

Use this when your engine:
- Runs **in-process** as a TypeScript/JavaScript SDK (no subprocess)
- Manages its own LLM API calls directly
- Injects context via synthetic tool calls rather than subprocess environment variables
- Example: **LLMist** (`src/backends/llmist/`)

For `sdk` engines, implement the `AgentEngine` interface directly (see `src/backends/types.ts`). There is no base class — you are responsible for all lifecycle details. Use the LLMist engine as your reference implementation.

**When in doubt, use `native-tool`.** It is the more common pattern and has more shared infrastructure.

---

## 2. Create the Engine Directory

Create a new directory under `src/backends/<engine-name>/`. The standard layout for a native-tool engine:

```
src/backends/my-engine/
├── index.ts          # Main engine class (extends NativeToolEngine)
├── env.ts            # Env-var allowlist (exports ALLOWED_ENV_EXACT)
├── models.ts         # Model ID list and default
└── settings.ts       # Zod schema + resolver for engine-specific settings (optional)
```

---

## 3. Define the Engine in `catalog.ts`

Add an `AgentEngineDefinition` constant to `src/backends/catalog.ts`:

```typescript
// src/backends/catalog.ts
export const MY_ENGINE_DEFINITION: AgentEngineDefinition = {
  id: 'my-engine',           // Stable string ID — used in DB and config
  label: 'My Engine',        // Human-readable label for the dashboard
  description: 'Short description of what this engine does.',
  archetype: 'native-tool',  // or 'sdk' for in-process engines
  capabilities: [
    'inline_prompt_context',
    'offloaded_context_files',
    'native_file_edit_tools',
    'external_cli_tools',
    'streaming_text_events',
    'streaming_tool_events',
    'scoped_env_secrets',
  ],
  modelSelection: {
    type: 'select',                      // or 'free-text' for open-ended model strings
    defaultValueLabel: 'Default (v1.0)',
    options: MY_ENGINE_MODELS,           // Imported from ./my-engine/models.ts
  },
  logLabel: 'My Engine Log',
  // Optional: add 'settings' if your engine has configurable fields
};
```

Add it to `DEFAULT_ENGINE_CATALOG` at the bottom of the same file:

```typescript
export const DEFAULT_ENGINE_CATALOG: AgentEngineDefinition[] = [
  CLAUDE_CODE_ENGINE_DEFINITION,
  LLMIST_ENGINE_DEFINITION,
  CODEX_ENGINE_DEFINITION,
  OPENCODE_ENGINE_DEFINITION,
  MY_ENGINE_DEFINITION,  // ← add here
];
```

---

## 4. Add Env Filtering (`env.ts`)

Every native-tool engine needs an **allowlist** of environment variables that may be passed to its subprocess. This prevents server-side secrets (`DATABASE_URL`, `REDIS_URL`, `CREDENTIAL_MASTER_KEY`, etc.) from leaking into agent processes.

Create `src/backends/my-engine/env.ts`:

```typescript
// src/backends/my-engine/env.ts
import { SHARED_ALLOWED_ENV_EXACT } from '../shared/envFilter.js';

/**
 * Exact variable names to pass through (shared + My Engine-specific).
 * Extend the shared set with auth vars specific to your engine.
 */
export const ALLOWED_ENV_EXACT = new Set([
  ...SHARED_ALLOWED_ENV_EXACT,

  // My Engine auth
  'MY_ENGINE_API_KEY',

  // Squint (pass through so agents can use AST tooling)
  'SQUINT_DB_PATH',
]);
```

The shared set (`SHARED_ALLOWED_ENV_EXACT` from `src/backends/shared/envFilter.js`) already includes:
- System vars: `HOME`, `PATH`, `SHELL`, `USER`, `LANG`, `TZ`
- Node vars: `NODE_PATH`, `NODE_EXTRA_CA_CERTS`
- Editor/color: `EDITOR`, `FORCE_COLOR`, `NO_COLOR`
- CASCADE internal: progress comment state, GitHub ack comment ID, session state vars

The shared prefix allowlist (`SHARED_ALLOWED_ENV_PREFIXES`) passes through `LC_*`, `XDG_*`, `GIT_*`, `SSH_*`, `GPG_*`, and `DOCKER_*` automatically.

---

## 5. Define Models (`models.ts`)

Create `src/backends/my-engine/models.ts`:

```typescript
// src/backends/my-engine/models.ts
export const MY_ENGINE_MODELS = [
  { value: 'my-engine-v1', label: 'My Engine v1 (default)' },
  { value: 'my-engine-v2', label: 'My Engine v2 (latest)' },
] as const;

export const MY_ENGINE_MODEL_IDS = MY_ENGINE_MODELS.map((m) => m.value);
export const DEFAULT_MY_ENGINE_MODEL = 'my-engine-v1';
```

If your engine accepts arbitrary model strings (e.g., OpenCode which uses `provider/model` format), use `modelSelection: { type: 'free-text' }` in the definition and skip the model list.

---

## 6. Add Settings Schema (Optional)

If your engine has configurable behaviour (e.g., approval policy, reasoning effort, web search), define a Zod schema for it.

Create `src/backends/my-engine/settings.ts`:

```typescript
// src/backends/my-engine/settings.ts
import { z } from 'zod';
import { type EngineSettings, getEngineSettings } from '../../config/engineSettings.js';
import type { ProjectConfig } from '../../types/index.js';

export const MY_ENGINE_SETTING_DEFAULTS = {
  mode: 'balanced' as const,
  webSearch: false,
};

export const MyEngineSettingsSchema = z.object({
  mode: z.enum(['fast', 'balanced', 'thorough']).optional(),
  webSearch: z.boolean().optional(),
});

export type MyEngineSettings = z.infer<typeof MyEngineSettingsSchema>;

export function resolveMyEngineSettings(
  project: ProjectConfig,
  engineSettings?: EngineSettings,
): Required<MyEngineSettings> {
  const effectiveSettings = engineSettings ?? project.engineSettings;
  const settings = getEngineSettings(effectiveSettings, 'my-engine', MyEngineSettingsSchema) ?? {};
  return {
    mode: settings.mode ?? MY_ENGINE_SETTING_DEFAULTS.mode,
    webSearch: settings.webSearch ?? MY_ENGINE_SETTING_DEFAULTS.webSearch,
  };
}
```

Then expose these settings in your `AgentEngineDefinition` (in `catalog.ts`):

```typescript
settings: {
  title: 'My Engine Settings',
  description: 'Behaviour controls for My Engine runs.',
  fields: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      options: [
        { value: 'fast', label: 'Fast' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'thorough', label: 'Thorough' },
      ],
    },
    {
      key: 'webSearch',
      label: 'Web Search',
      type: 'boolean',
      description: 'Allow web search during runs.',
    },
  ],
},
```

---

## 7. Implement the Engine Class (`index.ts`)

Here is the minimal template for a native-tool subprocess engine. This is what you **must** implement:

```typescript
// src/backends/my-engine/index.ts
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { MY_ENGINE_DEFINITION } from '../catalog.js';
import { NativeToolEngine } from '../shared/NativeToolEngine.js';
import { buildEngineResult, extractAndBuildPrEvidence } from '../shared/engineResult.js';
import { buildSystemPrompt, buildTaskPrompt } from '../shared/nativeToolPrompts.js';
import type { AgentEngineResult, AgentExecutionPlan } from '../types.js';
import { ALLOWED_ENV_EXACT } from './env.js';
import { DEFAULT_MY_ENGINE_MODEL, MY_ENGINE_MODEL_IDS } from './models.js';
import { MyEngineSettingsSchema, resolveMyEngineSettings } from './settings.js';

// ─── Model resolution ────────────────────────────────────────────────────────

function resolveMyEngineModel(cascadeModel: string): string {
  if (MY_ENGINE_MODEL_IDS.includes(cascadeModel)) return cascadeModel;
  // Add engine-prefixed model strings if your engine supports them
  throw new Error(
    `Model "${cascadeModel}" is not compatible with My Engine. ` +
    `Configure a supported model (e.g. "${DEFAULT_MY_ENGINE_MODEL}") or switch engines.`
  );
}

// ─── Engine class ────────────────────────────────────────────────────────────

/**
 * My Engine backend for CASCADE.
 *
 * Extends NativeToolEngine to share subprocess env-building, supportsAgentType(),
 * resolveModel() delegation, and base afterExecute() context cleanup.
 */
export class MyEngine extends NativeToolEngine {
  readonly definition = MY_ENGINE_DEFINITION;

  // ── NativeToolEngine abstract methods ──────────────────────────────────────

  getAllowedEnvExact(): Set<string> {
    return ALLOWED_ENV_EXACT;
  }

  getExtraEnvVars(): Record<string, string> {
    return { CI: 'true' };
  }

  resolveEngineModel(cascadeModel: string): string {
    return resolveMyEngineModel(cascadeModel);
  }

  // ── Optional lifecycle hooks ───────────────────────────────────────────────

  getSettingsSchema() {
    return MyEngineSettingsSchema;
  }

  async beforeExecute(plan: AgentExecutionPlan): Promise<void> {
    // Write auth files, validate prerequisites, etc.
    // Called by the adapter before execute().
  }

  async afterExecute(plan: AgentExecutionPlan, result: AgentEngineResult): Promise<void> {
    await super.afterExecute(plan, result); // Cleans up offloaded context files
    // Additional cleanup (remove temp files, kill sidecars, etc.)
  }

  // ── Core execution ─────────────────────────────────────────────────────────

  async execute(input: AgentExecutionPlan): Promise<AgentEngineResult> {
    const startTime = Date.now();

    // 1. Build prompts
    const systemPrompt = buildSystemPrompt(input.systemPrompt, input.availableTools);
    const { prompt: taskPrompt, hasOffloadedContext: _hasOffloadedContext } = await buildTaskPrompt(
      input.taskPrompt,
      input.contextInjections,
      input.repoDir,
    );

    // 2. Resolve model — idempotent, safe to call even without the adapter
    const model = resolveMyEngineModel(input.model);

    // 3. Resolve settings
    const settings = resolveMyEngineSettings(input.project, input.engineSettings);

    // 4. Build subprocess environment
    const env = this.buildEnv(input.projectSecrets, input.cliToolsDir, input.nativeToolShimDir);

    input.logWriter('INFO', 'Starting My Engine execution', {
      agentType: input.agentType,
      model,
      repoDir: input.repoDir,
      maxIterations: input.maxIterations,
    });

    // 5. Spawn the subprocess and stream output
    const rawTextParts: string[] = [];
    const stderrChunks: string[] = [];
    let iterationCount = 0;

    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn('my-engine', [
        '--model', model,
        '--mode', settings.mode,
        '--json',           // Request JSONL/structured output if available
        input.repoDir,
      ], {
        cwd: input.repoDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.once('error', (error) => {
        reject(
          error instanceof Error && 'code' in error && error.code === 'ENOENT'
            ? new Error('my-engine CLI not found in PATH. Install it in the worker image.')
            : error,
        );
      });

      // Pipe the combined prompt to stdin
      child.stdin.write(`${systemPrompt}\n\n${taskPrompt}`);
      child.stdin.end();

      const stdout = createInterface({ input: child.stdout });
      stdout.on('line', (line) => {
        rawTextParts.push(line);
        input.progressReporter.onText(line);
        iterationCount++;
        void input.progressReporter.onIteration(iterationCount, input.maxIterations);
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderrChunks.push(chunk.toString());
      });

      child.once('close', (code) => resolve(code ?? 1));
    });

    const finalOutput = rawTextParts.join('\n').trim();
    const { prUrl, prEvidence } = extractAndBuildPrEvidence(finalOutput);

    input.logWriter('INFO', 'My Engine execution completed', {
      exitCode,
      turns: iterationCount,
      durationMs: Date.now() - startTime,
    });

    if (exitCode !== 0) {
      return buildEngineResult({
        success: false,
        output: finalOutput,
        error: stderrChunks.join('').trim() || `my-engine exited with code ${exitCode}`,
        prUrl,
        prEvidence,
      });
    }

    return buildEngineResult({
      success: true,
      output: finalOutput,
      prUrl,
      prEvidence,
    });
  }
}

export { resolveMyEngineModel };
```

### Key helpers used above

| Helper | Location | Purpose |
|--------|----------|---------|
| `buildSystemPrompt(systemPrompt, availableTools)` | `src/backends/shared/nativeToolPrompts.ts` | Formats the system prompt with tool guidance |
| `buildTaskPrompt(taskPrompt, contextInjections, repoDir)` | `src/backends/shared/nativeToolPrompts.ts` | Offloads large context to files when needed |
| `this.buildEnv(projectSecrets, cliToolsDir, nativeToolShimDir)` | `NativeToolEngine` base class | Builds a sanitised subprocess env |
| `buildEngineResult({ ... })` | `src/backends/shared/engineResult.ts` | Constructs `AgentEngineResult` |
| `extractAndBuildPrEvidence(output)` | `src/backends/shared/engineResult.ts` | Extracts PR URL from output text |

---

## 8. Register in `bootstrap.ts`

Add your engine to `src/backends/bootstrap.ts` so it is available at runtime:

```typescript
// src/backends/bootstrap.ts
import { MyEngine } from './my-engine/index.js';

export function registerBuiltInEngines(): void {
  // ... existing engines ...
  if (!getEngine('my-engine')) {
    registerEngineWithSettings(new MyEngine());
  }
}
```

`registerEngineWithSettings` handles both `registerEngine()` and `registerEngineSettingsSchema()` in one call. If your engine does not implement `getSettingsSchema()`, use `registerEngine()` directly instead.

---

## 9. Update `Dockerfile.worker`

Install your engine's CLI binary in `Dockerfile.worker`. Follow the pattern used for the existing engines:

```dockerfile
# Install my-engine CLI
RUN npm install -g @my-org/my-engine@1.0.0
```

Search `Dockerfile.worker` for `@anthropic-ai/claude-code` or `@openai/codex` to find the right place to add your install step.

---

## 10. Test Your Engine

### A. Engine-contract test (required)

Create `tests/unit/backends/my-engine.test.ts` to verify the contract. Look at existing engine tests for the pattern:

```
tests/unit/backends/
├── claude-code.test.ts
├── codex.test.ts
└── opencode.test.ts
```

At minimum, test:
1. **`definition`** — correct `id`, `archetype`, `capabilities`
2. **`resolveEngineModel()`** — valid model strings pass, invalid ones throw
3. **`getAllowedEnvExact()`** — contains engine auth var; does NOT contain blocked vars
4. **`getExtraEnvVars()`** — returns expected constants (e.g. `CI: 'true'`)
5. **`getSettingsSchema()`** — schema validates expected shape (if implemented)
6. **`execute()`** — with mocked subprocess, returns expected result shape

### B. Env filter test (required)

Create `tests/unit/backends/my-engine-env.test.ts` to verify that sensitive variables are blocked:

```typescript
import { ALLOWED_ENV_EXACT } from '../../../src/backends/my-engine/env.js';
import { SHARED_BLOCKED_ENV_EXACT } from '../../../src/backends/shared/envFilter.js';

it('does not allow any blocked vars', () => {
  for (const blocked of SHARED_BLOCKED_ENV_EXACT) {
    expect(ALLOWED_ENV_EXACT.has(blocked)).toBe(false);
  }
});

it('allows engine auth var', () => {
  expect(ALLOWED_ENV_EXACT.has('MY_ENGINE_API_KEY')).toBe(true);
});
```

### C. Unit tests for settings (if applicable)

Test that `resolveMyEngineSettings()` applies defaults correctly and that the schema validates the expected shape.

### Running tests

```bash
npm test                              # All unit tests
npx vitest run tests/unit/backends/  # Just backend tests
```

---

## 11. Wire Up CLI and Dashboard (Automatic)

No CLI or dashboard changes are needed. CASCADE reads the engine catalog dynamically:

- **Dashboard Project Settings** — `getEngineCatalog()` returns all registered engines
- **`cascade projects update --agent-engine my-engine`** — the CLI uses the same dynamic list
- **`cascade agents create --engine my-engine`** — same
- Engine settings fields defined in `AgentEngineDefinition.settings` are rendered automatically in the Agent Configs tab

---

## Summary Checklist

- [ ] Create `src/backends/my-engine/` directory with `index.ts`, `env.ts`, `models.ts`
- [ ] Add `MY_ENGINE_DEFINITION` to `src/backends/catalog.ts` with correct `archetype`
- [ ] Set `ALLOWED_ENV_EXACT` in `env.ts` — extends shared set, adds engine auth vars
- [ ] Implement `getSettingsSchema()` and `settings.ts` if the engine has configurable options
- [ ] Implement `resolveEngineModel()` — validate and map CASCADE model strings
- [ ] Implement `execute()` — spawn subprocess, stream output, return `AgentEngineResult`
- [ ] Implement `beforeExecute()` / `afterExecute()` hooks if auth files or cleanup are needed
- [ ] Register in `src/backends/bootstrap.ts` via `registerEngineWithSettings()`
- [ ] Add engine CLI install step to `Dockerfile.worker`
- [ ] Write engine-contract tests and env-filter tests
- [ ] Run `npm test` and `npm run typecheck` — all green

---

## Real-World Examples

Refer to these implementations for patterns and guidance:

| Engine | Archetype | Location | Notable patterns |
|--------|-----------|----------|-----------------|
| Claude Code | `native-tool` | `src/backends/claude-code/` | SDK-based (not subprocess), `beforeExecute` writes onboarding flag, `afterExecute` cleans up session |
| Codex | `native-tool` | `src/backends/codex/` | Subprocess via `spawn`, JSONL output parsing, subscription auth with token refresh |
| OpenCode | `native-tool` | `src/backends/opencode/` | HTTP server protocol, `runContinuationLoop` for multi-turn, permission policy config |
| LLMist | `sdk` | `src/backends/llmist/` | In-process SDK, synthetic context injection, no `NativeToolEngine` base class |

---

## Architecture Quick-Reference

```
src/backends/
├── types.ts                    # AgentEngine, AgentEngineDefinition, AgentExecutionPlan interfaces
├── catalog.ts                  # AgentEngineDefinition constants + DEFAULT_ENGINE_CATALOG
├── registry.ts                 # Runtime engine registry (registerEngine, getEngine, isNativeToolEngine)
├── bootstrap.ts                # Registers all built-in engines + their settings schemas
├── adapter.ts                  # Shared lifecycle: repo setup, prompts, secrets, post-processing
├── shared/
│   ├── NativeToolEngine.ts     # Abstract base class for native-tool engines
│   ├── envFilter.ts            # Shared env-var allowlists and filterProcessEnv()
│   ├── envBuilder.ts           # buildEngineEnv() — the single env construction entry point
│   ├── nativeToolPrompts.ts    # buildSystemPrompt() and buildTaskPrompt() helpers
│   ├── engineResult.ts         # buildEngineResult(), extractAndBuildPrEvidence()
│   └── contextFiles.ts         # cleanupContextFiles() for offloaded context
├── claude-code/                # Native-tool (SDK-based)
├── codex/                      # Native-tool (subprocess, JSONL)
├── opencode/                   # Native-tool (HTTP server protocol)
└── llmist/                     # SDK archetype (in-process)
```
