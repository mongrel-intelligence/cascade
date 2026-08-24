---
id: 024
slug: shared-board-repo-topologies
plan: 3
plan_slug: jira-scope-and-stamp
level: plan
parent_spec: docs/specs/024-shared-board-repo-topologies.md
depends_on: [1-schema-and-resolver-seam.md]
status: pending
---

# 024/3: JIRA read scoping and work-item stamping

> Part 3 of 5 in the 024-shared-board-repo-topologies plan. Parent spec: resolve `docs/specs/024-shared-board-repo-topologies.md*`.

## Summary

Makes a discriminator-scoped project see and produce only its own slice of a shared board. Two symmetric halves: **read scoping** — `listWorkItems` appends the discriminator to its JQL so agents (backlog-manager pulls, list-based gadgets) never pick up the sibling team's issues; **write stamping** — `createWorkItem` applies the discriminator (label appended / component set) to every item the project creates (friction reports, alert cards, split children all flow through this one method), so created items carry the attribute that routes their future events back to the origin project.

File-disjoint from plan 2 (owns the PM adapter + JIRA client; plan 2 owns the router adapter). Together with plan 2 it completes spec AC #7; on its own it completes AC #6. Also removes the "don't enable sharing yet" caveat plan 2 placed in the README.

**Components delivered:**
- Discriminator-aware JQL in `listWorkItems`
- Discriminator stamping in `createWorkItem` (label and component kinds)
- `components` passthrough on the JIRA client's issue creation
- "Scoping & stamping" subsection in the architecture guide; caveat removal

**Files owned (exclusive to this plan within this spec):**
- `src/pm/jira/adapter.ts`
- `src/jira/client.ts`
- `tests/unit/pm/jira/routing-scope.test.ts` (new)

**Shared surfaces (append-only, conflicts are trivial):**
- `src/integrations/README.md` — appends the scoping subsection under plan 2's routing section and deletes plan 2's one-sentence caveat (mechanical rebase if plan 2 merges later)

**Deferred to later plans in this spec:**
- Wizard UI for setting the discriminator (plan 5)

---

## Spec ACs satisfied by this plan

- Spec AC #6 (scoped reads return only own-discriminator items) — **full**
- Spec AC #7 (created items carry the discriminator and route back) — **partial (this plan provides the stamping; plan 2 provides the routing of stamped items)** — completes together with plan 2
- Spec AC #12 (single-project identical) — **partial (no-discriminator configs produce byte-identical JQL and creation payloads; explicit pins below)**

---

## Depends On

- Plan 1 (`schema-and-resolver-seam`) — provides the `routing.discriminator` config field shape on `JiraConfig`.
- No dependency on plan 2 — runnable in parallel.

---

## Detailed Task List (TDD)

### 1. Read scoping: `listWorkItems` JQL

Current behavior: `src/pm/jira/adapter.ts` builds `project = "KEY"` plus optional `AND status = "..."` (status-mapping block around line 230–245).

**Tests first** (`tests/unit/pm/jira/routing-scope.test.ts`; `vi.mock` the `jiraClient` per the existing `tests/unit/pm/jira/adapter.test.ts` pattern, asserting on the JQL string passed to the search call):

- `no discriminator produces today's JQL exactly` — unit — config without `routing` → JQL `project = "KEY"` (+status clause when filtered), byte-identical to current. Expected red: n/a green-from-start (AC #12 pin — must hold before and after).
- `label discriminator appends labels clause` — unit — `routing.discriminator {kind:'label', value:'team-be'}` → JQL contains `AND labels = "team-be"`. Expected red: `expected JQL to contain 'AND labels = "team-be"'`.
- `component discriminator appends component clause` — unit — kind component, value `Backend` → `AND component = "Backend"`. Expected red: clause absent.
- `discriminator composes with status filter` — unit — both configured → JQL contains both `AND` clauses in stable order (status first, discriminator last). Expected red: one clause missing or unstable order.
- `discriminator value is quoted` — unit — value with a space (`team be`) → quoted in JQL, no injection of raw operators. Expected red: unquoted value in JQL.

**Implementation** (`src/pm/jira/adapter.ts`):
- Extend the `JiraConfig` interface with `routing?: { discriminator: { kind: 'label' | 'component'; value: string } }` (mirrors plan 1's zod shape).
- Private helper `discriminatorJqlClause(): string` → `''` when unset; ` AND labels = "v"` / ` AND component = "v"` otherwise (double-quoted value, existing quoting convention of the status clause).
- Append in `listWorkItems` after the status clause.

### 2. Write stamping: `createWorkItem`

Current behavior: `createWorkItem` (around line 189) passes `labels: config.labels` when non-empty; no components support in `jiraClient.createIssue`.

**Tests first** (`tests/unit/pm/jira/routing-scope.test.ts`):

- `no discriminator creates with unchanged payload` — unit — config without routing → `createIssue` called with today's exact field set (no `components` key present at all). Expected red: n/a green-from-start (AC #12 pin).
- `label discriminator appends to labels` — unit — caller passes `labels: ['cascade-auto']`, discriminator label `team-be` → `createIssue` receives `labels: ['cascade-auto','team-be']`; with no caller labels → `['team-be']`. Expected red: `expected labels to contain 'team-be'`.
- `label discriminator not duplicated` — unit — caller already includes `team-be` → appears once. Expected red: `expected length 1, got 2`.
- `component discriminator sets components field` — unit — kind component `Backend` → `createIssue` receives `components: [{ name: 'Backend' }]`. Expected red: `components` undefined.
- `jiraClient.createIssue forwards components` — unit — client-level test: params with `components` → REST payload `fields.components` populated; params without → field absent. Expected red: `expected fields.components to deep-equal [{name:'Backend'}]`.

**Implementation**:
- `src/jira/client.ts` `createIssue`: accept optional `components?: Array<{ name: string }>` and forward into the create fields (only when present — absence keeps today's payload byte-identical).
- `src/pm/jira/adapter.ts` `createWorkItem`: merge the discriminator per kind before calling the client (label → dedup-append to the labels array; component → set `components`). All internal creators (friction materializer, alert materializer, splitting) call `createWorkItem`, so no other call sites change — assert this by grep in review, not by test.

### 3. Documentation

**Implementation** (`src/integrations/README.md`):
- Append "Scoping & stamping" subsection under the shared-key routing section (JQL clause semantics, stamping semantics, dedup rule, case-sensitivity note).
- Delete plan 2's "do not configure sharing until scoping ships" caveat sentence. If plan 2 has not merged yet, add the subsection standalone and skip the deletion (the caveat won't exist); note for the implementer.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/pm/jira/routing-scope.test.ts`: ~10 tests covering JQL scoping, stamping both kinds, dedup, quoting, and the two byte-identical no-discriminator pins

### Integration tests
- [ ] none new

### Acceptance tests
- [ ] Per-plan ACs below map onto the suite

---

## Manual Verification

n/a — all ACs auto-tested.

---

## Acceptance Criteria (per-plan, testable)

1. With a label discriminator, `listWorkItems` JQL includes `AND labels = "<value>"`; with a component discriminator, `AND component = "<value>"`; values quoted.
2. With a discriminator, `createWorkItem` stamps the created issue (label dedup-appended / component set); `jiraClient.createIssue` forwards `components` when given.
3. Without a discriminator, both JQL and creation payloads are byte-identical to pre-plan behavior (pin tests).
4. All new/modified code has corresponding tests.
5. `npm run typecheck` passes.
6. `npm test` passes.
7. `npm run lint` passes.
8. Documentation listed below updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `src/integrations/README.md` | Append "Scoping & stamping" subsection; remove plan 2's interim caveat if present |

---

## Out of Scope (this plan)

- Event routing (plan 2), GitHub side (plan 4), wizard UI (plan 5)
- Backfilling discriminators onto existing issues (spec out-of-scope)
- Scoping for Trello/Linear (spec out-of-scope)

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1
- [ ] AC #2
- [ ] AC #3
- [ ] AC #4
- [ ] AC #5
- [ ] AC #6
- [ ] AC #7
- [ ] AC #8
