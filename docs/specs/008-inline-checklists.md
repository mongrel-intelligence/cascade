---
id: 008
slug: inline-checklists
level: spec
title: Inline markdown checklists for Linear and JIRA
created: 2026-04-17
status: draft
---

# 008: Inline markdown checklists for Linear and JIRA

## Problem & Motivation

CASCADE's checklist system (acceptance criteria, implementation steps, dependency lists) works well on Trello because Trello has native in-card checklists — lightweight items that live inside a card, not as separate entities. Linear and JIRA lack this concept. The current adapters work around it by creating **full sub-issues / subtasks** for each checklist item.

This causes real problems. A splitting agent that breaks a feature into 5 stories with 6 acceptance criteria each creates **30 additional issues** in the workspace — each with its own identifier, state, project assignment (or lack thereof, per the bug fixed in PR #1138), and lifecycle. These items clutter board views, pollute search results, appear in backlog counts, and confuse users who see dozens of "Tests verify…" items as top-level work. They also inherit the team's default workflow state ("Ideas"), which is semantically wrong for metadata that describes a criterion, not a task.

The fix: for providers that lack native checklists (Linear, JIRA), represent checklist items as **inline markdown checkboxes** appended to the parent issue's description. Both Linear and JIRA render `- [ ]` / `- [x]` as interactive checkboxes in their editors. This matches the lightweight semantics of Trello's checklists without creating orphan issues.

---

## Goals

- Checklist items for Linear and JIRA are stored as markdown checkboxes in the parent issue's description, not as sub-issues / subtasks.
- Agents can still create checklists, add items, mark items complete/incomplete, and delete items through the same PMProvider interface — no agent prompt changes needed.
- The `ReadWorkItem` gadget returns checklist items in the same `## Checklists` format regardless of provider, so agents parse them identically.
- Trello behavior is unchanged — it continues using its native checklist API.

---

## Non-goals

- Building a generic markdown-to-checklist parsing library. The implementation should be minimal and specific to CASCADE's own checklist format.
- Supporting nested checklists (checklists within checklists). One level of checkboxes per section is sufficient.
- Migrating existing sub-issues / subtasks that were created before this change. Forward-only.
- Changing how the **splitting agent creates new work items**. `CreateWorkItem` still creates real issues — only `AddChecklist` / `AddChecklistItem` behavior changes.

---

## Constraints

- The PMProvider interface must not change. All six checklist methods (`getChecklists`, `createChecklist`, `addChecklistItem`, `updateChecklistItem`, `deleteChecklistItem`, plus the checklist section in `getWorkItem`) retain their signatures.
- Description updates must be safe under concurrent access: read-modify-write with one retry on conflict.
- Both Linear and JIRA descriptions support markdown. Linear uses plain markdown; JIRA uses Atlassian Document Format (ADF) but the JIRA adapter already has a `markdownToAdf` converter.
- Checklist item IDs must be stable for agents to reference. Use a content hash derived from the item text.

---

## User stories / Requirements

1. As a PM using Linear, when the splitting agent adds acceptance criteria to a story, I see them as checkboxes in the issue description — not as child issues in my backlog.
2. As a PM using JIRA, when the splitting agent adds acceptance criteria, I see them as checkboxes in the issue description — not as subtasks inflating my sprint board.
3. As an implementation agent, I can mark acceptance criteria complete via `UpdateChecklistItem` and the checkbox toggles in the description.
4. As a user viewing a work item in Linear/JIRA, I see clearly labeled checklist sections (e.g. "✅ Acceptance Criteria") with interactive checkboxes.
5. As any agent, `ReadWorkItem` returns checklist items in the standard `## Checklists` format with item IDs, regardless of whether the provider uses native checklists, subtasks, or inline markdown.

---

## Research Notes

- Linear's description field supports full markdown including `- [ ]` / `- [x]` checkboxes, rendered as interactive toggles in the UI. Linear also has a built-in "Create sub-issue(s) from selection" feature for converting checklists TO sub-issues — confirming they treat these as distinct concepts. ([Linear Docs](https://linear.app/docs/creating-issues))
- Linear's `IssueUpdateInput` accepts a `description` field for updating issue content via GraphQL. ([Apollo Studio Schema](https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/inputs/IssueUpdateInput))
- JIRA's REST API supports updating the `description` field via `PUT /rest/api/3/issue/{id}`. The description uses ADF (Atlassian Document Format), which has a `taskList` / `taskItem` node type for checklists. CASCADE already has a `markdownToAdf` converter.
- Linear sub-issues are limited to one level of nesting. ([Linear Docs — Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues))

---

## Open Source Decisions

No external libraries needed. The markdown parsing required is minimal (find a heading, find `- [ ]` / `- [x]` lines under it). A regex-based approach is sufficient and avoids adding a markdown AST dependency.

---

## Strategic decisions

1. **Inline in description, not comments** — chose appending to description over posting comments. Reason: descriptions are the canonical place users look; comments scroll away and are harder to programmatically update.
2. **Content hash for item IDs** — chose hashing item text over positional indexes or embedded markers. Reason: stable as long as text doesn't change (which is the common case for acceptance criteria), no noise in the description, no extra state.
3. **Read-modify-write with retry** — chose optimistic read-modify-write over append-only comments or unconditional overwrite. Reason: handles the common case of no conflict efficiently, retries once on stale data, avoids data loss.
4. **Forward-only, no migration** — chose not migrating existing sub-issues. Reason: migration is risky (deleting issues), and the old items still work as they are. New checklists use the new approach.
5. **Both Linear and JIRA** — chose to fix both providers in the same spec rather than Linear-only. Reason: same problem, same solution shape, avoids doing this twice.
6. **Trello unchanged** — Trello's native checklists work correctly. No changes.

---

## Acceptance Criteria (outcome-level)

1. When the splitting agent adds "✅ Acceptance Criteria" to a newly created Linear story, the criteria appear as markdown checkboxes in the story's description — no child issues are created.
2. When the splitting agent adds "✅ Acceptance Criteria" to a newly created JIRA story, the criteria appear as checkboxes in the story's description — no subtasks are created.
3. When the implementation agent marks an acceptance criterion complete, the corresponding checkbox in the description toggles from `- [ ]` to `- [x]`.
4. When an agent calls `ReadWorkItem`, the inline markdown checkboxes are parsed and returned in the standard `## Checklists` format with stable item IDs.
5. When an agent calls `DeleteChecklistItem`, the corresponding line is removed from the description.
6. Trello checklist behavior is completely unchanged.
7. The PMProvider interface (method signatures, return types) does not change.
8. Concurrent description updates (two agents updating the same issue) do not silently lose data — the second write retries after re-reading.

---

## Documentation Impact (high-level)

- `CLAUDE.md` — No changes needed (checklist behavior is internal to the adapters).
- `src/integrations/README.md` — Add a note about the inline checklist pattern for providers without native checklists.
- `CHANGELOG.md` — Entry describing the behavior change for Linear and JIRA checklists.

---

## Out of Scope

- Migrating existing sub-issues / subtasks created before this change.
- Changing Trello's checklist implementation.
- Changing how `CreateWorkItem` works (stories remain real issues).
- Nested checklists or multi-level checkbox hierarchies.
- Rich checklist metadata beyond name and checked/unchecked state.
- Agent prompt changes (the PMProvider interface stays the same).
