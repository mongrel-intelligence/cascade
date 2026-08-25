# Open bugs

Findings surfaced during `/z:implement` review gates that were **out of scope**
for the plan that found them. Each entry names how it was found, what breaks,
and the shape a fix would take — so it survives the session it was found in.

Close an entry by deleting it in the PR that fixes it.

---

## Moving a project to a different repository can strand the old one

**Found:** spec 024 plan 4 review (2026-08-24) · **Fix shape:** adhoc

`resolveRepoPrimary` (`src/api/routers/projects.ts`) validates only the repo
being saved. Moving a repository's **primary** to a different repo leaves the old
repo with secondaries and no primary — the same total event drop the
zero-primary guard prevents, reached by a different door.

Needs the update path to compare `input.repo` against the project's current repo
and, when they differ, check what the vacated repo is left with.

---

## `jiraEnsureLabels` reads and writes a sibling's issue on a shared board

**Found:** spec 024 plan 3 review (2026-08-24) · **Fix shape:** small, needs a spec decision

`src/api/routers/webhooks/jira.ts:224` is the only JQL builder outside the PM
adapter, and it is unscoped: it searches `project = "KEY" ORDER BY created DESC`,
takes the first issue, PUTs CASCADE's labels onto it to force JIRA to register
them, then PUTs the originals back (`:251-263`).

On a **shared** project key (spec 024) that first issue can belong to a sibling
project. Each PUT emits `jira:issue_updated`, which spec 024 plan 2 now routes to
whichever sibling owns the issue — so a wizard save on one project can fire a
trigger on **another team's** issue. If `cascade-ready` is among the seeded
labels, `JiraReadyToProcessLabelTrigger` is the one that fires.

Pre-existing and wizard-time-only: the same self-trigger risk exists in a
single-project setup, where it touches your own issue. Spec 024 amplifies the
blast radius from "your issue" to "someone else's". Not caused by plan 3, and
genuinely outside its file ownership.

**Fix shape:** scope that search with the project's own discriminator clause
(the adapter's `discriminatorJqlClause` is the same logic), or stop mutating a
real issue altogether. The second is better if JIRA offers any other way to
register a label — worth checking before building the first.

---

## `webhookLogsRepository > filters by receivedAfter date` fails (2 tests)

**Found:** spec 024 plan 2 review (2026-08-24) · **Fix shape:** adhoc

Two integration tests fail in `tests/integration/db/webhookLogsRepository.test.ts`.
Verified pre-existing: they fail identically at commit `870a8034` in a clean
worktree, so no spec-024 work caused them. Unit suite and the rest of the
integration suite are green.
