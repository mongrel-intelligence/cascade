# Changelog

All notable user-visible changes to CASCADE are documented here. The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project does not use strict semver for releases.

## Unreleased

### Fixed

- **Review agent on external-fork and large PRs.** PR checkouts now use the canonical `refs/pull/N/head` ref, which works for same-repo branches and external-fork branches alike. Previously, a silent `git checkout <branch>` failure on fork PRs caused the worker to review the base branch (`dev`) while believing it was on the PR branch, producing confidently wrong reviews. Any git or HEAD-SHA mismatch now fails the run loudly rather than silently continuing. Additionally, every paginated GitHub REST endpoint used in the review setup pipeline now paginates to completion, so PRs with more than 100 changed files are no longer truncated at the first page. (Spec [001](docs/specs/001-pr-review-correctness.md), plan [1/2](docs/plans/001-pr-review-correctness/1-checkout-and-pagination.md.done).)
