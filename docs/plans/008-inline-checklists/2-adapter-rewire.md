---
id: 008
slug: inline-checklists
plan: 2
plan_slug: adapter-rewire
level: plan
parent_spec: docs/specs/008-inline-checklists.md
depends_on: [1-markdown-engine.md]
status: pending
---

# 008/2: Adapter Rewiring — Linear + JIRA Inline Checklists

> Part 2 of 2 in the 008-inline-checklists plan. See [parent spec](../../specs/008-inline-checklists.md).

## Summary

Replaces the sub-issue/subtask checklist implementation in both the Linear and JIRA adapters with the inline markdown engine from plan 1. After this plan, `addChecklistItem` appends a markdown checkbox to the parent issue's description instead of creating a child issue. `updateChecklistItem` toggles the checkbox. `deleteChecklistItem` removes the line. `getChecklists` parses the description to extract checklist sections.

Also reverts the incorrect `stateId` addition to `addChecklistItem` from PR #1139 (that method will no longer create issues at all), extends JIRA's `adfToPlainText` to handle `taskList`/`taskItem` nodes for the ADF→markdown→mutate→ADF round-trip, and updates documentation.

**Components delivered:**
- `src/pm/linear/adapter.ts` — all 5 checklist methods rewritten to use inline engine
- `src/pm/jira/adapter.ts` — all 5 checklist methods rewritten to use inline engine
- `src/pm/jira/adf.ts` — `adfToPlainText` extended for `taskList`/`taskItem`
- `tests/unit/pm/linear/adapter.test.ts` — checklist test sections rewritten
- `tests/unit/pm/jira/adapter.test.ts` — checklist test sections rewritten
- `tests/unit/pm/jira/adf.test.ts` — taskList/taskItem tests (find or create)
- `src/integrations/README.md` — inline checklist pattern documented
- `CHANGELOG.md` — behavior change entry

**Deferred to later specs:**
- Nothing — this plan completes the spec.

---

## Spec ACs satisfied by this plan

- Spec AC #1 (Linear: criteria as checkboxes, no child issues) — **full**
- Spec AC #2 (JIRA: criteria as checkboxes, no subtasks) — **full**
- Spec AC #3 (Implementation agent toggles checkbox via UpdateChecklistItem) — **full**
- Spec AC #4 (ReadWorkItem returns inline checkboxes as standard Checklists format) — **full** (completes partial from plan 1)
- Spec AC #5 (DeleteChecklistItem removes line from description) — **full**
- Spec AC #6 (Trello unchanged) — **full** (no Trello code touched)
- Spec AC #7 (PMProvider interface unchanged) — **full**
- Spec AC #8 (Concurrent updates with retry) — **full**

---

## Depends On

- Plan 1 (markdown-engine) — provides `parseInlineChecklists`, `appendChecklistSection`, `addItemToChecklist`, `toggleChecklistItem`, `removeChecklistItem`, `hashChecklistItemId`.

---

## Detailed Task List (TDD)

### 1. Extend JIRA ADF converter for taskList/taskItem

**Tests first** (`tests/unit/pm/jira/adf.test.ts` — find existing or create):
- `adfToPlainText({ type: 'taskList', content: [{ type: 'taskItem', attrs: { state: 'TODO' }, content: [{ type: 'text', text: 'Item 1' }] }] })` → `- [ ] Item 1`
- `taskItem` with `state: 'DONE'` → `- [x] Item 2`
- Mixed `taskList` with TODO and DONE items
- `taskList` nested inside document with other content (paragraphs, headings)

**Implementation** (`src/pm/jira/adf.ts`):
- Add `taskList` case to `convertAdfNode`: map items via their `taskItem` children
- Add `taskItem` case: check `attrs.state === 'DONE'` → `[x]`, else `[ ]`. Prefix with `- `. Content is `adfToPlainText(item)`.

### 2. Rewrite Linear checklist methods

**Tests first** (`tests/unit/pm/linear/adapter.test.ts`):

- **`getChecklists`**: Mock `linearClient.getIssue()` to return issue with description containing inline checklists. Assert parsed `Checklist[]` with correct items, IDs, and checked states. Test with empty description → `[]`. Test with description that has no checklist sections → `[]`.
- **`createChecklist`**: Mock `linearClient.getIssue()` + `linearClient.updateIssue()`. Assert description is updated with new `### {name}` section appended. Assert returned `Checklist` object has correct ID format.
- **`addChecklistItem`**: Mock get + update. Assert new `- [ ] {name}` line added under correct section. Assert `linearClient.createIssue` is **NOT** called (sub-issue creation removed).
- **`updateChecklistItem`**: Mock get + update. Assert `- [ ]` toggled to `- [x]` (or vice versa) for the item matching the given ID. Assert `linearClient.updateIssueState` is **NOT** called.
- **`deleteChecklistItem`**: Mock get + update. Assert the item line is removed. Assert empty section heading is cleaned up.
- **Retry on conflict**: Mock `linearClient.updateIssue` to throw on first call (stale), succeed on second. Assert description re-read and retry succeeds.

**Implementation** (`src/pm/linear/adapter.ts`):
- `getChecklists(workItemId)`:
  1. `const issue = await linearClient.getIssue(workItemId)`
  2. `return parseInlineChecklists(issue.description ?? '').map(c => ({ ...c, workItemId }))`
  3. Generate checklist IDs: `inline-{workItemId}-{hashOfChecklistName}`
- `createChecklist(workItemId, name)`:
  1. Read issue description
  2. `const newDesc = appendChecklistSection(desc, name, [])`
  3. `await linearClient.updateIssue(workItemId, { description: newDesc })`
  4. Return `Checklist` with generated ID, empty items
- `addChecklistItem(checklistId, name, checked, description)`:
  1. Extract workItemId and checklist name from checklistId
  2. Read issue description
  3. `const newDesc = addItemToChecklist(desc, checklistName, name, checked)`
  4. Write back with retry
- `updateChecklistItem(workItemId, checkItemId, complete)`:
  1. Read issue description
  2. Parse checklists
  3. `const newDesc = toggleChecklistItem(desc, checkItemId, complete, checklists)`
  4. Write back with retry
- `deleteChecklistItem(workItemId, checkItemId)`:
  1. Read issue description
  2. Parse checklists
  3. `const newDesc = removeChecklistItem(desc, checkItemId, checklists)`
  4. Write back with retry

**Helper — read-modify-write with retry:**
- `private async updateDescription(issueId: string, mutate: (desc: string) => string): Promise<void>`
- Reads issue, applies mutate, writes back. On write error, re-reads and retries once.

**Revert PR #1139:**
- Remove the `stateId` spread from `addChecklistItem` (line 230 — it was adding `stateId` to a `createIssue` call that no longer happens)

### 3. Rewrite JIRA checklist methods

**Tests first** (`tests/unit/pm/jira/adapter.test.ts`):

- **`getChecklists`**: Mock `jiraClient.getIssue()` to return issue with ADF description containing taskList nodes. Assert parsed `Checklist[]` with correct items. Test with no taskList nodes → `[]`.
- **`createChecklist`**: Mock get + update. Assert description updated with appended checklist section (in ADF via markdownToAdf round-trip).
- **`addChecklistItem`**: Mock get + update. Assert item added. Assert `jiraClient.createIssue` is **NOT** called (subtask creation removed).
- **`updateChecklistItem`**: Mock get + update. Assert checkbox toggled. Assert no transition calls.
- **`deleteChecklistItem`**: Mock get + update. Assert item removed. Assert `jiraClient.deleteIssue` is **NOT** called.
- **ADF round-trip**: ADF → markdown (adfToPlainText) → mutate → ADF (markdownToAdf). Assert checklists survive the round-trip with correct state.

**Implementation** (`src/pm/jira/adapter.ts`):
- Same pattern as Linear but with ADF conversion layer:
  1. Read issue → `adfToPlainText(issue.fields.description)` → markdown string
  2. Apply mutation via inline engine
  3. `markdownToAdf(newMarkdown)` → ADF document
  4. `jiraClient.updateIssue(id, { description: adfDoc })`
- `getChecklists`: Read description as ADF → convert to markdown → `parseInlineChecklists`
- Read-modify-write retry: same pattern as Linear

**Checklist ID encoding for JIRA:**
- checklistId format: `inline-{workItemKey}-{hashOfChecklistName}`
- Extract workItemKey and checklist name from this ID in `addChecklistItem`

### 4. Update ReadWorkItem formatting

**Tests first** (`tests/unit/gadgets/pm/core/readWorkItem.test.ts` or wherever `formatChecklists` is tested):
- Verify `formatChecklists` works identically with inline-parsed checklists (it should — the `Checklist` type hasn't changed)
- Verify item IDs in the `[checkItemId: cl-...]` format are correctly embedded

**Implementation** (`src/gadgets/pm/core/readWorkItem.ts`):
- No changes expected — `formatChecklists` already formats `Checklist[]` generically. The inline engine returns the same types. Verify and add a test to confirm.

### 5. Conformance harness updates

**Tests first:**
- Check if `tests/unit/integrations/pm-conformance.test.ts` tests checklist methods. If so, update expectations to match inline behavior.

**Implementation:**
- Update any conformance test expectations that assert sub-issue creation or state transitions for checklist operations.

### 6. Documentation

**Implementation:**
- `src/integrations/README.md`: Add a section "Checklist implementation by provider" explaining that Trello uses native checklists, while Linear and JIRA use inline markdown checkboxes in the description.
- `CHANGELOG.md`: Entry describing the behavior change — checklists for Linear and JIRA are now stored as markdown checkboxes in the issue description instead of sub-issues/subtasks.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/pm/jira/adf.test.ts`: ~4 tests for taskList/taskItem → markdown conversion
- [ ] `tests/unit/pm/linear/adapter.test.ts`: ~12 tests (rewrite checklist section)
- [ ] `tests/unit/pm/jira/adapter.test.ts`: ~12 tests (rewrite checklist section)
- [ ] `tests/unit/gadgets/pm/core/readWorkItem.test.ts`: ~2 tests confirming inline checklists format correctly

### Integration tests
- None (checklist behavior is unit-testable via mocked clients)

### Acceptance tests
- [ ] End-to-end: Linear adapter — appendChecklist → addItem → getChecklists → updateItem → deleteItem → getChecklists — full lifecycle via unit test with mocked client
- [ ] End-to-end: JIRA adapter — same lifecycle with ADF round-trip
- [ ] Trello adapter tests unchanged and still passing

---

## Acceptance Criteria (per-plan, testable)

1. Linear `addChecklistItem` appends a markdown checkbox to the description — does NOT call `linearClient.createIssue`.
2. JIRA `addChecklistItem` appends a markdown checkbox (via ADF round-trip) to the description — does NOT call `jiraClient.createIssue`.
3. Linear `updateChecklistItem` toggles a checkbox in the description — does NOT call `linearClient.updateIssueState`.
4. JIRA `updateChecklistItem` toggles a checkbox in the description — does NOT call `jiraClient.transitionIssue`.
5. Linear `getChecklists` parses the description and returns `Checklist[]` with content-hash item IDs.
6. JIRA `getChecklists` converts ADF to markdown, parses, and returns `Checklist[]`.
7. Linear `deleteChecklistItem` removes the item line from the description.
8. JIRA `deleteChecklistItem` removes the item line from the description — does NOT call `jiraClient.deleteIssue`.
9. `adfToPlainText` handles `taskList`/`taskItem` nodes, producing `- [ ]`/`- [x]` markdown.
10. `ReadWorkItem` formats inline checklists identically to native checklists (same `## Checklists` format with `[checkItemId:]` markers).
11. Trello checklist tests pass unchanged.
12. PMProvider interface (method signatures, return types) is unchanged.
13. Read-modify-write with retry: when description update fails once, adapter re-reads and retries.
14. All new/modified code has corresponding tests.
15. `npm run build` passes.
16. `npm test` passes.
17. `npm run lint` passes.
18. All documentation listed in Documentation Impact has been updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `src/integrations/README.md` | Add "Checklist implementation by provider" section |
| `CHANGELOG.md` | Entry: Linear and JIRA checklists now use inline markdown instead of sub-issues/subtasks |

---

## Out of Scope (this plan)

- Migrating existing sub-issues / subtasks (out of scope per spec)
- Trello changes (out of scope per spec)
- Nested checklists (out of scope per spec)
- Agent prompt changes (out of scope per spec)
- CreateWorkItem behavior (unchanged per spec)

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
- [ ] AC #9
- [ ] AC #10
- [ ] AC #11
- [ ] AC #12
- [ ] AC #13
- [ ] AC #14
- [ ] AC #15
- [ ] AC #16
- [ ] AC #17
- [ ] AC #18
