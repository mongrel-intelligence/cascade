# Agents, prompts and context

**Applies to:** `src/agents/**`, `src/worker-entry.ts`, `src/config/reviewConfig.ts`, `src/config/claudeCodeConfig.ts`, `src/config/updateChannel.ts`

Mechanism lives in [04-agent-system](../architecture/04-agent-system.md) and [03-trigger-system](../architecture/03-trigger-system.md).

## Prompts

- Prompt templates and partials live in `src/agents/prompts/templates/`; the `prompt_partials` table shadows disk (DB first, disk fallback — `src/agents/prompts/index.ts`). After editing a partial run `npm run db:seed-prompts`, or workers keep using the old copy.
- `tests/unit/agents/prompts.test.ts` pins phrases the templates must keep; run it after any template change.

## Context injection

- Context injections are inlined only while under `CONTEXT_OFFLOAD_CONFIG.inlineThreshold` (`src/config/claudeCodeConfig.ts`); larger ones are written to `.cascade/context/` for on-demand reads (`src/backends/shared/contextFiles.ts`). The target repo's `CLAUDE.md` / `AGENTS.md` are `cat`-injected by `readContextFiles` (`src/agents/utils/setup.ts`) — `@` imports are not expanded, so keep those files small.
- In `fetchPRContextStep` keep `getPR` / `getPRDiff` fatal and `getCheckSuiteStatus` non-fatal → 03-trigger-system § prContext budget and debugging.
- The review diff budget is `REVIEW_DIFF_CONTEXT_TOKEN_LIMIT` with a 10 % per-file cap; when a reviewer "missed" a file, read the `PR context prepared` log before touching budgets → 03-trigger-system § prContext budget and debugging.

## Behaviour gates

- `updateChannel` gates communication-only posting (acks, progress, summaries, comment/review tools); never gate workflow actions (PR creation, status moves, labels, checklists) behind it → 04-agent-system § Update Channel.
- Communication-only gadgets are removed by `filterPostingGadgetNames` in both the native-tool and LLMist paths; a new posting tool must be added to that list → 04-agent-system § Update Channel.
- Repository checkout uses `refs/pull/<N>/head` (`src/agents/shared/repository.ts`); do not reintroduce branch-name checkout → [01-services § Repository checkout](../architecture/01-services.md).
