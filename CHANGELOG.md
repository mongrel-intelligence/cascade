# Changelog

All notable user-visible changes to CASCADE are documented here. The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project does not use strict semver for releases.

## Unreleased

### Changed

- **Review-agent context shape: compact diffs instead of full files.** The review agent's pre-fetched PR context now consists of compact per-file diffs (using GitHub's `file.patch`) rather than full file contents. Files that can't fit the budget — deleted, binary, oversized patch, or cumulative budget exhausted — are surfaced in a structured `SKIPPED FILES` injection that names each file with a reason and tells the agent how to fetch it on demand (`gh pr diff`, `Read`, `Grep`). This scales with PR size rather than repo size, mitigates LLM context rot, and ensures the agent is aware of (rather than blind to) the omissions. The context budget is `REVIEW_DIFF_CONTEXT_TOKEN_LIMIT` (200k tokens), replacing the prior 25k full-file cap. The `SKIPPED FILES` injection is also delivered to the four other agents that share the PR context pipeline (`respond-to-ci`, `respond-to-pr-comment`, `respond-to-review`, `resolve-conflicts`); explicit prompt guidance is added in `review.yaml` only. (Spec [001](docs/specs/001-pr-review-correctness.md), plan [2/2](docs/plans/001-pr-review-correctness/2-context-rework.md.done).)

### Fixed

- **Review agent on external-fork and large PRs.** PR checkouts now use the canonical `refs/pull/N/head` ref, which works for same-repo branches and external-fork branches alike. Previously, a silent `git checkout <branch>` failure on fork PRs caused the worker to review the base branch (`dev`) while believing it was on the PR branch, producing confidently wrong reviews. Any git or HEAD-SHA mismatch now fails the run loudly rather than silently continuing. Additionally, every paginated GitHub REST endpoint used in the review setup pipeline now paginates to completion, so PRs with more than 100 changed files are no longer truncated at the first page. (Spec [001](docs/specs/001-pr-review-correctness.md), plan [1/2](docs/plans/001-pr-review-correctness/1-checkout-and-pagination.md.done).)
