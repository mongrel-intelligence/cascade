---
id: 025
slug: pr-comment-completion-and-codex-resume
level: spec
title: Outcome-aware PR comment completion and reliable Codex resume
created: 2026-08-25
status: draft
---

# 025: Outcome-aware PR comment completion and reliable Codex resume

## Problem & Motivation

The PR-comment agent handles two legitimately different kinds of work: it may answer a question by posting a comment, or it may change code and push commits. Its task guidance already distinguishes those outcomes, but its completion contract does not. Every run currently requires a newly pushed commit, so a successful comment-only response is rejected even when the requested external action completed.

This mismatch triggered a second latent defect in a production run. After the agent successfully posted its answer, the completion gate detected no pushed-change evidence and attempted to continue the same Codex session. The continuation command placed parent execution options after the resume subcommand and session identifier. The pinned Codex CLI rejected that grammar before contacting the model, and the dashboard recorded the whole run as failed despite the requested response already being visible on the pull request.

The two failures compound but need separate corrections. Completion must recognize the authoritative outcome that actually satisfies a mixed-purpose task, while remaining fail-closed when neither valid outcome occurred. Codex continuation must also obey the pinned CLI's command grammar so a legitimate missing-evidence continuation can reach the existing session instead of failing in argument parsing.

---

## Goals

1. A PR-comment run that successfully posts a substantive response without changing the repository completes successfully without requiring an artificial commit.
2. A PR-comment run that changes repository state still requires clean, authoritative pushed-change evidence before it can complete.
3. Completion requirements can express alternative valid outcomes without weakening the strict requirements of other agent types.
4. Successful external responses are recorded durably enough that continuation does not duplicate them.
5. Codex continuation turns preserve the original session and accept all configured execution options under the pinned CLI grammar.
6. Operators can determine which completion outcome succeeded or why no valid outcome matched from normal run logs.

---

## Non-goals

- Pre-classifying every incoming comment as a question or code-change request before agent dispatch.
- Changing the completion contracts of review-response, CI-response, conflict-resolution, implementation, review, or planning agents.
- Changing agent models, prompts, iteration budgets, or update-channel behavior.
- Replacing the native-tool continuation loop or introducing a general workflow engine.
- Redesigning the Codex integration beyond continuation command compatibility.
- Retrying or rewriting historical failed runs automatically.
- Credential rotation, historical-log cleanup, or general secret-redaction work.

---

## Constraints

- Missing, malformed, or contradictory completion evidence must fail closed.
- A comment-only outcome is valid only when a new substantive PR response was recorded successfully, the working tree is clean, and the repository HEAD is unchanged from run start.
- Editing a pre-existing acknowledgment or progress comment does not count as the substantive response.
- A changed repository can complete only through the existing authoritative pushed-change path.
- Existing strict completion behavior remains backward compatible for every agent that does not opt into alternative outcomes.
- Continuation must not repeat an external response already recorded as successful.
- Codex command construction must remain compatible with the version pinned in the worker image, and version upgrades must surface incompatible grammar before deployment.
- The change must use existing completion-artifact and process-launch infrastructure; no new runtime dependency is justified.
- All behavior changes follow test-first development.

---

## User stories / Requirements

1. **As a pull-request participant asking a question**, I receive a direct answer and see the automation run complete successfully without an unrelated code commit.
2. **As a pull-request participant requesting code changes**, I do not see the automation run complete until its repository changes are committed and pushed.
3. **As an operator**, I can distinguish a run completed by a substantive response from one completed by pushed changes.
4. **As an operator**, I see a precise failure when neither valid outcome has authoritative evidence, rather than a generic or misleading pushed-change error.
5. **As an operator**, I do not see duplicate responses when the engine receives a continuation turn after the first response was already posted.
6. **As an engine maintainer**, I can add an agent with multiple valid completion outcomes without adding agent-name conditionals to shared completion logic.
7. **As an engine maintainer upgrading Codex**, I receive an automated compatibility failure if continuation arguments no longer match the pinned CLI grammar.

---

## Research Notes

- OpenAI documents non-interactive continuation as `codex exec resume <SESSION_ID>` and describes execution controls as options of the parent `exec` command. Command construction must preserve that hierarchy rather than treating every option as valid after `resume`. [OpenAI Codex non-interactive mode](https://developers.openai.com/codex/non-interactive-mode)
- Codex's Rust command parser follows clap's subcommand model. Clap documents that parent arguments propagate into child subcommands only when they are declared global; ordinary parent-only arguments cannot be moved below a subcommand boundary. [clap argument documentation](https://docs.rs/clap/latest/clap/struct.Arg.html)
- AWS Step Functions models mixed workflows with explicit choice branches selected from current state. When no branch matches and there is no default, execution fails instead of silently claiming success. This maps well to fail-closed alternative completion outcomes. [AWS Step Functions Choice state](https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html)
- JSON Schema's `anyOf` represents the relevant validation semantics: one or more complete alternatives may satisfy the contract, unlike `allOf`, which requires every branch. Completion alternatives should remain explicit groups rather than weakening individual evidence checks. [JSON Schema composition](https://json-schema.org/understanding-json-schema/reference/combining)
- Temporal recommends durable records for external side effects and idempotent retry behavior because work may complete before the orchestrator records completion. A successful PR response therefore needs authoritative evidence that survives an engine continuation. [Temporal Activity guidance](https://docs.temporal.io/activity-definition)
- Exit status alone is insufficient for this orchestration layer: a subprocess can exit successfully while the requested workflow outcome remains unsatisfied, or a later continuation can fail after an earlier external action succeeded. Completion must be derived from outcome evidence and then mapped to the final run status. [GitHub Actions exit-code semantics](https://docs.github.com/actions/creating-actions/setting-exit-codes-for-actions)

---

## Open Source Decisions

| Tool | License | Solves | Decision | Reason |
|---|---|---|---|---|
| [OpenAI Codex CLI](https://github.com/openai/codex) | Apache-2.0 | Non-interactive agent execution and session resume | **Keep and pin** | It is already the supported engine. The defect is command construction, not missing CLI capability. |
| [XState](https://stately.ai/docs/machines) | MIT | General state-machine modeling with guarded transitions | **Skip** | Alternative completion validation is a small extension of existing infrastructure; a runtime state-machine dependency would add disproportionate surface area. |
| [Temporal](https://temporal.io/) | MIT client SDKs; server under its published license | Durable workflows, side-effect history, retries | **Reference only** | Its evidence and idempotency principles are useful, but adopting a workflow platform is far outside this correction's scope. |
| JSON Schema composition | Specification | Declarative AND/OR/XOR validation semantics | **Copy the model, not a library** | The existing completion contract can represent explicit alternatives without adding runtime schema evaluation. |

---

## Strategic decisions

1. **Model completion as explicit alternative outcomes.** A mixed-purpose agent may declare multiple complete success paths; satisfying any one path is sufficient. Rejected: removing the push requirement entirely. Reason: that would allow code-changing work to finish unpushed.
2. **Require authoritative response evidence for comment-only success.** A successful new top-level PR response or inline review reply counts; editing an acknowledgment does not. The repository must also remain clean and at its initial HEAD. Rejected: trusting final prose or a clean checkout alone. Reason: neither proves that the requested human-facing response occurred.
3. **Keep pushed-change evidence strict.** If repository state changes, only the existing clean-and-pushed outcome may complete the run. Rejected: allowing a posted comment to mask local or unpushed changes. Reason: it would strand incomplete code in the worker.
4. **Make the completion abstraction shared but opt-in.** Alternative outcomes are engine-agnostic and contain no PR-comment-agent conditional; only the PR-comment profile opts in initially. Rejected: a one-off special case. Reason: shared semantics prevent drift across native-tool engines.
5. **Persist external-response evidence and make continuation duplicate-safe.** Once a substantive response succeeds, later completion checks reuse that evidence and continuation guidance must not ask for another response. Rejected: inferring success from engine text or transient tool logs. Reason: both are non-authoritative and may be lost or duplicated across turns.
6. **Fail closed on evidence uncertainty.** Missing, malformed, or mismatched response and push evidence satisfies no branch. Rejected: best-effort success. Reason: a false success is worse than a visible, actionable failure.
7. **Treat Codex CLI grammar as a versioned integration contract.** Parent execution options remain before the resume subcommand; resume identity and follow-up input remain in the subcommand's argument domain. Rejected: suppressing the parser error or starting a fresh session. Reason: both lose continuation correctness.
8. **Verify grammar at two levels.** Focused tests lock the generated argument structure, and a model-free parser smoke check exercises the pinned CLI during worker-image validation. Rejected: mocks alone. Reason: the existing mock asserted the malformed ordering and could not detect the real parser rejection.
9. **Add no dependency.** Existing completion artifacts, process invocation, and worker validation are sufficient. Rejected: adding a state-machine or command-builder library. Reason: neither would materially improve this narrowly bounded contract.

---

## Acceptance Criteria (outcome-level)

1. When a PR-comment run receives a question, successfully posts a new substantive response, and leaves the repository clean and unchanged, the dashboard records the run as completed without any new commit.
2. When a PR-comment run changes repository files but has not committed and pushed those changes, posting a response does not allow completion; the run continues or fails with an actionable pushed-change reason.
3. When a PR-comment run commits and pushes requested code changes, authoritative pushed-change evidence completes the run under the existing strict guarantees.
4. Updating only the system-created acknowledgment or progress comment does not satisfy the substantive-response outcome.
5. Missing, malformed, or inconsistent response evidence satisfies no completion alternative and produces an actionable failure reason in run logs.
6. If a substantive response was recorded before a continuation, the continuation does not post the same response again.
7. The PR-comment completion behavior is identical across all native-tool engines that support the agent.
8. Agents that require pushed changes today continue to fail when they produce no new pushed commit; none inherit the comment-only alternative implicitly.
9. A Codex continuation with repository, model, sandbox, output, and configuration options reaches the requested existing session without an argument-parser error.
10. An incompatible Codex CLI argument grammar causes worker-image validation to fail before an affected image can execute project work.
11. Run logs identify the completion alternative that succeeded, or identify why each available alternative was rejected, without relying on the engine's prose claim.

---

## Documentation Impact (high-level)

- `docs/architecture/04-agent-system.md` — describe alternative completion outcomes and the PR-comment agent's response-or-push contract.
- `docs/architecture/05-engine-backends.md` — document evidence-driven continuation semantics and the Codex resume command hierarchy.
- `docs/adding-engines.md` — add the requirement that continuation-capable engines preserve session identity and pass a model-free compatibility check.
- `CHANGELOG.md` — record the corrected comment-only completion behavior and Codex continuation compatibility fix.
- No `CLAUDE.md` change: these rules have clear homes in engine and agent architecture documentation and are derivable from the completion contract.

---

## Out of Scope

- General classification of incoming PR comments before dispatch.
- Comment-only completion for agents other than the PR-comment agent.
- Changes to communication-channel policy or tool availability.
- A dashboard redesign or new completion-outcome UI.
- Database schema changes or historical run backfills.
- Automatic retry of runs that failed before this change.
- General command-line abstraction work across other engines.
- Credential rotation, stored-log deletion, and general-purpose secret redaction.
