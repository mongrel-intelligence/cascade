---
id: 001
slug: pr-review-correctness
level: spec
title: PR Review Correctness — External Forks, Large PRs, and Pre-Fetch Strategy
created: 2026-04-15
status: draft
---

# 001: PR Review Correctness — External Forks, Large PRs, and Pre-Fetch Strategy

## Problem & Motivation

On 2026-04-14, the automated review agent posted a `CHANGES_REQUESTED` review on PR #1092 (CASCADE's first external contribution, from @suda, adding GitLab SCM support). The review flagged **three blocking issues**, all of which were fabricated — the code the bot claimed was broken was in fact correct on the PR branch. The cost was $7.24, 6m 49s of compute, and real reputational damage: an external contributor's first PR was met with a confidently wrong review.

Root-cause analysis revealed two independent, latent defects that compounded:

1. **Silent working-tree mismatch.** The worker clones `origin` (our monorepo) on its configured base branch, then attempts to check out the PR branch by name. For internal PRs the branch exists on origin and the checkout succeeds. For external PRs the branch lives on the contributor's fork, not on origin — the checkout silently fails with a non-zero exit code that the surrounding code discards. The worker proceeds on the base branch believing it is on the PR branch, and every file read returns pre-PR content.
2. **Truncated context.** The review agent's pre-fetch loads **full file contents** of each changed PR file up to a 25,000-token cap, and fetches files via a single page of the GitHub files API (capped at 100). PR #1092 had 129 files; only 20 files' content fit under the token cap. The agent's view of "what changed" was a subset of what actually changed, and the files that would have refuted its false claims were among those skipped.

This never manifested before because no prior PR was both (a) from an external fork **and** (b) large enough to overflow the pre-fetch budget. Both conditions will recur — every external contribution and every sufficiently large internal PR is at risk.

Beyond the immediate correctness failures, the pre-fetch design is fundamentally mis-shaped. Industry best practice for LLM code review is to feed the model **compact diffs** (scaling with PR size) and let the agent fetch file content on demand through its existing tools. Our current design inverts this: we echo full files (scaling with repo size) and give the agent no signal when its view is incomplete.

---

## Goals

1. Review runs on external-fork PRs read and reason about the **contributor's actual changes**, not the base branch.
2. Review runs on large PRs see **all** files the PR modifies — no silent truncation of the changed-files list.
3. When the pre-fetch cannot include every file's content, the agent knows **which files were omitted** and has clear guidance to fetch them on demand.
4. When any step of the review-setup pipeline fails (clone, fetch, checkout, verification), the run is marked failed rather than proceeding on a degraded state.
5. The review agent's context budget is spent on high-signal content (diffs) rather than low-signal content (unchanged lines of a changed file).

---

## Non-goals

- Changing the review agent's output format, prompt style, or model.
- Introducing multi-hop / agentic context gathering beyond what the existing tool-call surface provides.
- Indexing the repository into a searchable graph (Greptile-style).
- Running the review agent against the PR's merge-commit (as opposed to the head commit).
- Changing how internal (same-origin) PR branches are referred to by users, dashboards, or logs.
- Altering any database schema or migration.

---

## Constraints

- **TDD-first.** Every behavior change must be preceded by a failing test that demonstrates the bug or the new requirement.
- **No hacks, no workarounds, no half-measures.** If a code path silently tolerates errors today, it must fail loudly going forward — no "keep the old path for safety" fallbacks.
- **No regression for the internal-PR happy path.** Runs triggered by same-origin PRs must continue to succeed with equivalent or better fidelity.
- **No breaking change to project credentials, DB schema, or configuration surface.** The contract with operators (environment variables, project config fields, stored credentials) is unchanged.
- **Observable via existing logging and run-tracking.** New failure modes must surface in the normal run logs and the dashboard's run status — no new telemetry pipeline.
- **Latency budget preserved.** The review run's end-to-end duration should not materially increase. Pagination and per-file diff extraction must add no more than a small constant to setup time.

---

## Requirements

1. **R1 — External-fork checkout.** The review worker must successfully place the working tree at the PR head commit when the PR originates from an external fork, regardless of whether the branch exists on the base-repo remote.
2. **R2 — Fail-loud setup.** Every git operation in the review setup path must surface non-zero exit codes as failed runs. There are no "warn and continue" paths in setup.
3. **R3 — HEAD verification.** After checkout completes, the worker must verify that the resulting HEAD commit matches the PR's head commit as reported by the GitHub API. A mismatch is a failed run.
4. **R4 — Complete changed-files enumeration.** The pre-fetch must enumerate **every** file the PR changes, not only the first page returned by the API.
5. **R5 — Diff-shaped context.** The pre-fetch must feed the agent compact per-file diffs, not full file contents, as the default representation of PR changes.
6. **R6 — Skipped-file transparency.** When content cannot be pre-fetched (e.g., over budget, deleted, binary), the agent receives a structured list of omitted files and explicit guidance to fetch them through its existing tools when relevant.
7. **R7 — Pagination elsewhere in the review pipeline.** Other paginated GitHub endpoints consumed during review setup (PR commits, PR comments, check runs, reviews) are read to completion, not truncated at the first page.
8. **R8 — Post-fix observability.** Run logs make visible: which ref was fetched, the resolved HEAD SHA, the count of changed files discovered, the count of files whose content was included vs skipped, and the reason for any skip.

---

## Research Notes

- GitHub exposes every pull request as a ref at `refs/pull/N/head` on the base repository, regardless of whether the PR originates from a same-repo branch or an external fork. This ref pattern is the canonical way to check out any PR. Reference: [GitHub Docs — Checking out pull requests locally](https://docs.github.com/articles/checking-out-pull-requests-locally).
- The `actions/checkout` GitHub Action uses exactly this pattern when handling PRs from forks, and serves as a reference implementation for a robust PR checkout sequence. Reference: [actions/checkout](https://github.com/actions/checkout).
- LLM code review quality degrades as input context grows, even when the window is not technically full — "context rot." Loading full file contents when only a handful of lines changed is both wasteful and counterproductive. Reference: [Morph LLM — Context Rot](https://www.morphllm.com/context-rot).
- Current best practice in LLM-driven code review (per Martin Fowler's context-engineering survey) is to use compact per-file diffs with explicit file-path headers, reserving full-file reads for the agent to perform on demand via its tool surface. Reference: [Martin Fowler — Context Engineering for Coding Agents](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html).
- Commercially deployed AI code review tools split into two architectures: "diff-only" (CodeRabbit-class, faster, lower noise) and "codebase-indexed + multi-hop" (Greptile-class, higher bug-catch, more cost). CASCADE's review agent is diff-class today, with an existing tool surface (Read, Grep, Bash) that enables limited on-demand exploration. Moving to compact diffs fits this class well; adopting codebase indexing is a larger, separate effort. Reference: [Greptile vs CodeRabbit (2025)](https://www.greptile.com/greptile-vs-coderabbit).
- GitHub's `pulls/N/files` endpoint has a documented hard cap of 3000 files per PR and a per-page cap of 100; pagination is mandatory for any PR larger than 100 files.

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|------|--------|----------|--------|
| [Octokit paginate-rest plugin](https://github.com/octokit/plugin-paginate-rest.js) | Iterating all pages of any paginated GitHub REST endpoint | **Use** | Already bundled with `@octokit/rest`; idiomatic, well-tested, replaces per-site hand-rolled pagination |
| [actions/checkout (as reference impl)](https://github.com/actions/checkout) | How a robust PR-fork checkout sequence is structured | **Copy pattern** | Not consumable as a library; but its `refs/pull/N/head` fetch sequence is the industry-standard recipe to mirror |
| `simple-git`, `nodegit`, and other JS git wrappers | Abstracting direct git-command invocation | **Skip** | The codebase already invokes git through a uniform subprocess helper; swapping to a library would be churn without clear benefit |
| Existing "compact diff" libraries (unified-diff renderers, etc.) | Formatting per-file patches for LLM consumption | **Skip, write in-house** | GitHub's PR files API already returns per-file patch strings; formatting is a thin wrapper around that data |

---

## Strategic decisions

1. **Checkout pattern.** Use GitHub's canonical `refs/pull/N/head` ref for every PR checkout regardless of origin (same-repo or external fork). Rejected: keeping the branch-name path for same-repo PRs with a branch on origin. Reason: one code path, one failure mode, one test surface; eliminates the entire "branch-not-on-origin" class of bug.
2. **Error-handling philosophy.** Fail-loud throughout the review setup pipeline. Any non-zero git exit, any failed API call, any unexpected state transitions the run to failed. Rejected: warn-and-continue with best-effort. Reason: silent partial success is what caused the incident; an honest failure surfaces the problem to operators and retries.
3. **HEAD verification.** Mandatory SHA equality check between `git rev-parse HEAD` and the PR's head commit as reported by the GitHub API, executed after checkout and before any review work. Rejected: optional / debug-gated. Reason: cheap final defense against any future bug that produces the wrong working tree.
4. **Context shape.** Default representation of PR changes fed to the agent is **compact per-file diffs**, not full file contents. Rejected: raising the full-file token cap; rejected: hybrid thresholds. Reason: aligns with industry practice, scales with PR size rather than repo size, mitigates context rot, and leverages the agent's existing tool surface for on-demand file reads.
5. **Skipped-file contract with the agent.** Whenever the pre-fetch omits a file's content or diff for any reason, the agent receives a structured, explicitly labeled list of omitted files with per-file reasons, and prompt guidance that instructs it to fetch omitted files via its tools when they are relevant to the review. Rejected: silent omission. Reason: the silent-omission pattern is precisely what enabled the PR #1092 incident.
6. **Pagination coverage.** Pagination is applied to every paginated GitHub endpoint consumed during review setup, not only the immediate `pulls/N/files` fix. Rejected: spot-fixing only the one endpoint that failed this time. Reason: the same latent bug class exists on neighboring endpoints; one comprehensive pass prevents a future repeat.
7. **Scope boundary.** In scope: git checkout correctness, pre-fetch rework to diffs, skipped-file contract, pagination coverage, HEAD verification, fail-loud setup. Out of scope: ops-layer detection of past `HEAD ≠ PR head` runs; agentic multi-hop context gathering; codebase indexing. Rejected: bundling ops tooling. Reason: different failure class, different owner, different test strategy, different deploy cadence.

---

## Acceptance Criteria (outcome-level)

1. When an external contributor (from a fork) opens a pull request that triggers a review, the review run's final working tree is at the PR's head commit.
2. When a pull request contains more than 100 changed files, the review agent's context includes every one of those files in its enumeration of what changed.
3. When any step of the review setup pipeline fails (clone, fetch, checkout, API call), the run is marked **failed** in the dashboard, with a log entry identifying the failing step. No such failure silently proceeds to a completed review.
4. When the working-tree SHA after setup differs from the PR's head SHA as reported by the GitHub API, the run is marked failed before any review work begins.
5. The agent's primary view of PR changes is compact per-file diffs. Full unchanged lines of changed files are not echoed into the agent's context by default.
6. When the pre-fetch omits any changed file's content or diff (for any reason), the agent receives an explicit, structured list of omitted filenames with a short reason for each, and prompt guidance telling it to fetch those files via its existing tools when relevant.
7. Other paginated GitHub endpoints consumed during review setup (PR commits, PR reviews, PR issue comments, check runs) are read to completion — the count returned to the agent matches the total the API reports.
8. An operator investigating a review run can determine from the run's log: which PR ref was fetched, the resolved HEAD SHA, the total number of changed files, and the count of included vs skipped content entries with per-skip reasons.
9. A review run on the reproduction case from PR #1092 (an external-fork PR with more than 100 changed files) produces a working tree at the correct head SHA, enumerates all changed files, and does not fabricate missing-export or wrong-import claims about files it has not read.

---

## Documentation Impact (high-level)

- `CLAUDE.md` — the "Development" and "Debugging Production Sessions" sections reference the review flow; they need updated notes on the new checkout behavior, diff-based pre-fetch, and skipped-file contract.
- `docs/architecture/` and `docs/ARCHITECTURE.md` — the trigger-to-agent data flow diagrams and descriptions need updating to reflect compact-diff context rather than full-file pre-fetch.
- `CHANGELOG.md` — entry describing the incident, the fix, and the behavior change visible to anyone inspecting review logs.
- `docs/adding-engines.md` — if engine onboarding docs describe the context shape passed to the agent, they need updating to describe diffs + skipped-file list rather than full file contents.
- `README.md` — brief mention in the "Dashboard" or "Running the Router" section only if the failure-mode change is visible to a fresh operator; otherwise no change.
- Per-file granular documentation edits are deferred to the downstream plan(s).

---

## Out of Scope

- Ops-layer detection of historical runs where the final HEAD did not match the PR head — a separate operational-monitoring concern.
- Agentic multi-hop context gathering, where the agent autonomously expands its context by following symbol references, git history, or related files — a larger architectural shift deferred to a future spec.
- Codebase-wide indexing (Greptile-style code graph) — a separate spec, requires distinct infrastructure.
- Running the review against the PR's generated merge commit rather than the head commit — distinct strategic choice with its own trade-offs, not driven by this incident.
- Multi-agent review orchestration (parallel specialized reviewers) — separate concern, future exploration.
- Changes to the review agent's model, prompt template, or output format.
- Changes to non-review agent types. This spec addresses the review agent specifically; if adjacent agent types (implementation, respond-to-review, etc.) share the vulnerable checkout code, those fixes are a natural side effect but their agent-level behavior is not being re-specified here.
