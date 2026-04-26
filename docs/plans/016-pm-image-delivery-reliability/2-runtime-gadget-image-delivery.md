---
id: 016
slug: pm-image-delivery-reliability
plan: 2
plan_slug: runtime-gadget-image-delivery
level: plan
parent_spec: docs/specs/016-pm-image-delivery-reliability.md
depends_on: [1-boot-path-mime-fix-and-diagnostic-log.md]
status: pending
---

# 016/2: Runtime gadget image delivery (mid-run pickup)

> Part 2 of 3 in the 016-pm-image-delivery-reliability plan. See [parent spec](../../specs/016-pm-image-delivery-reliability.md).

## Summary

This plan closes the mid-run gap. Today the runtime gadget `cascade-tools pm read-work-item` (`src/cli/pm/read-work-item.ts` → `src/gadgets/pm/core/readWorkItem.ts:167`) calls `readWorkItem(workItemId, includeComments)` which delegates to `readWorkItemWithMedia` and discards the returned media. The gadget's text output includes a "Pre-fetched Images" section that lists URL refs with descriptive labels but NO local file paths the agent can read.

After this plan ships, the runtime gadget downloads any image media it discovered and writes the bytes to `.cascade/context/images/work-item-<workItemId>-img-<index>.<ext>`, then returns text whose Pre-fetched Images section lists the actual relative file paths the agent can hand to its file-read tool. The same diagnostic log line introduced in Plan 1 fires here too — same prefix, same fields, same grep — so an operator triaging a "no image after re-read" report sees the boot-path summary AND the runtime-path summary in the run log with consistent shape.

This plan does NOT change the boot path's behavior (Plan 1 already shipped) and does NOT touch PR #948's Claude-Code initial-input path. The runtime gadget is engine-agnostic — it writes files on disk that any engine's file-read tool can consume.

**Components delivered:**
- `readWorkItem(workItemId, includeComments)` — the gadget surface — gains a sibling `readWorkItemWithImagesOnDisk` (or modifies the existing function) that downloads + writes images via the shared `downloadAndPrepareImages` helper from Plan 1, then formats the text output's Pre-fetched Images section to list the actual file paths.
- A new image-writer helper that takes the `{ images, failures }` shape returned by `downloadAndPrepareImages` and writes each image to disk using the `work-item-<id>-img-<index>.<ext>` naming convention. Extension is derived from the resolved MIME (`image/png` → `.png`); falls back to `.bin` with a warn log when MIME resolution failed.
- The same diagnostic log line from Plan 1, fired from the runtime gadget code path with `provider: <type>` and the same field schema. Reuses Plan 1's helper.
- Tests covering: extension-less Linear URL → on-disk file + path returned in text; mid-run change pickup (image added after agent boot, gadget re-fetch picks it up); failed-download case (text says download failed, no orphan path listed); regression for boot-path Codex / OpenCode / Claude Code engines that still go through their existing flows untouched.

**Deferred to later plans in this spec:**
- Linear GraphQL fixture + extraction-coverage regression test (Plan 3).
- `src/integrations/README.md`'s Linear-specific GraphQL surface confirmation (Plan 3).

---

## Spec ACs satisfied by this plan

- Spec AC #3 (runtime gadget delivers files-on-disk + paths in text) — **full**
- Spec AC #4 (mid-run image pickup) — **full**
- Spec AC #5 (single grep-stable diagnostic log line, runtime path) — **full** (combined with Plan 1's boot path)
- Spec AC #2 (Trello/JIRA regression-safe, runtime path) — **full** (regression tests)

---

## Depends On

- **Plan 1** (`1-boot-path-mime-fix-and-diagnostic-log.md`) — provides the shared `downloadAndPrepareImages` helper this plan imports, and the `mimeTypeFromUrl` + `isImageMimeType` widening that lets Linear extension-less URLs survive the filter at runtime as well as boot. Without Plan 1, the runtime gadget would face the exact same MIME-drop problem.

---

## Detailed Task List (TDD)

### 1. On-disk image writer for the runtime gadget

**Tests first** (`tests/unit/gadgets/pm/core/writeRuntimeImages.test.ts` — new file):

- `writeRuntimeImages — writes each image to .cascade/context/images/ with work-item-<id>-img-<index>.<ext>` — unit — pass `{ workItemId: 'MNG-357', images: [{ base64Data, mimeType: 'image/png', altText }, { base64Data, mimeType: 'image/jpeg', altText }] }`; mock `fs.writeFile`; assert it was called twice with paths matching `work-item-MNG-357-img-0.png` and `work-item-MNG-357-img-1.jpg` (note: `image/jpeg` resolves to `.jpg` extension per a stable map). Expected red: module not found.
- `writeRuntimeImages — derives extension from resolved MIME, NOT from URL` — unit — pass image with `mimeType: 'image/webp'`; assert filename ends `.webp`. Expected red: module not found.
- `writeRuntimeImages — falls back to .bin extension when MIME resolution failed (image/*)` — unit — pass image with `mimeType: 'image/*'` (the unresolved wildcard sentinel); assert filename ends `.bin` AND a warn log is emitted including the workItemId. Expected red: module not found.
- `writeRuntimeImages — returns the list of relative paths it wrote` — unit — assert returned `string[]` matches `[`.cascade/context/images/work-item-MNG-357-img-0.png`, ...]`. Expected red: module not found.
- `writeRuntimeImages — creates the .cascade/context/images directory if it does not exist` — unit — mock `fs.access` to throw; assert `fs.mkdir` is called with `recursive: true` and the correct path. Expected red: module not found.
- `writeRuntimeImages — preserves the same naming convention as Plan 1's boot-path writer` — unit — assert that calling Plan 1's `writeInjectionImages` with equivalent inputs produces a path identical to this helper's output. (If they diverge, the runtime path and boot path have different on-disk contracts — bad. Both should produce `work-item-<id>-img-<i>.<ext>`.) Expected red: ambiguous until Plan 1's writer is examined; the test should fail loudly if either side drifts.

**Implementation** (`src/gadgets/pm/core/writeRuntimeImages.ts` — new file):
- Function signature: `writeRuntimeImages({ workItemId, images, contextDir? }): Promise<{ paths: string[]; failures: { reason: string }[] }>`.
- `contextDir` defaults to `.cascade/context/images` (the existing `IMAGES_SUBDIR` from `src/backends/shared/contextFiles.ts:23`).
- Stable extension map: `image/png → .png`, `image/jpeg → .jpg`, `image/gif → .gif`, `image/webp → .webp`, `image/svg+xml → .svg`, `image/avif → .avif`, etc. — use the inverse of the existing `EXTENSION_MIME_MAP` from `src/pm/media.ts:65`.
- For unresolved `image/*`: extension `.bin` + warn log.
- The function is engine-agnostic — it writes raw bytes; whatever engine reads them later just calls its file-read tool.

### 2. Wire the writer into the runtime read-work-item gadget

**Tests first** (`tests/unit/gadgets/pm/core/readWorkItem.test.ts` — extend existing or create new):

- `readWorkItem — when work item has images, writes them to disk and returns text with relative paths` — unit — mock `readWorkItemWithMedia` to return `{ text: '...\n## Pre-fetched Images\n- [Image: foo.png] (description)\n', media: [{ url, mimeType: 'image/png', altText: 'foo.png', source: 'description' }] }`; mock `downloadAndPrepareImages` to succeed; mock `writeRuntimeImages` to return paths; assert returned text contains `.cascade/context/images/work-item-<id>-img-0.png` AND that the new path appears WHERE the existing "Pre-fetched Images" URL list was. Expected red: today the gadget returns text-only; the test asserts a substring that doesn't exist yet.
- `readWorkItem — when work item has no images, returns text unchanged (no Pre-fetched Images section, no disk write)` — unit — mock `readWorkItemWithMedia` to return `{ text: '...', media: [] }`; assert text is unchanged AND `writeRuntimeImages` is NOT called. Expected red: passes if the gadget today already gracefully skips the empty case (it does); fails right reason if implementation accidentally calls writer for empty media.
- `readWorkItem — emits the diagnostic log line at runtime path` — unit — assert exactly ONE INFO call matching `'[image-pipeline] work-item-fetch summary'` with `provider`, `workItemId`, `urlsDetected`, `urlsAfterFilter`, `urlsDownloaded`, `urlsFailed`, `urlsByMimeType`. Same prefix and shape as the boot-path log from Plan 1. Expected red: today no log fires from the runtime gadget; assertion fails because spy was never called.
- `readWorkItem — when download fails, the text marks the URL as failed and includes the reason` — unit — mock 2 images, 1 succeeds and 1 fails; assert returned text shows the successful path AND a failed-marker for the second URL (e.g. `- [Image: bar.png] download failed: <reason>`). Expected red: today the gadget has no failure handling.
- `readWorkItem — backward-compatible text shape: agents that don't read paths still see usable text` — unit — assert returned text still contains the existing `## Description`, `## Comments`, etc. sections; Pre-fetched Images section is the only one mutated. Expected red: today text shape is fixed; if Plan 2 accidentally drops a section, this fires.

**Implementation** (`src/gadgets/pm/core/readWorkItem.ts`):
- Modify `readWorkItem(workItemId, includeComments)` to:
  1. Call `readWorkItemWithMedia` (already returns `{ text, media }`).
  2. If `media.length > 0`: call `downloadAndPrepareImages` (Plan 1's shared helper) to get `{ images, failures }`.
  3. If `images.length > 0`: call `writeRuntimeImages` to write each to disk, getting back `{ paths, failures: writerFailures }`.
  4. Mutate the text's "Pre-fetched Images" section: replace each URL-ref line with the corresponding local file path. For download failures, replace with a failed-marker line. For writer failures (e.g. disk full), append a separate `## Failed to Write Images` section listing the URLs.
  5. Emit the diagnostic log line with all counts.
  6. Return the mutated text.
- Preserve `readWorkItemWithMedia` as-is (boot path uses it; this plan doesn't touch boot path).
- The new helper `downloadAndPrepareImages` is imported from `src/pm/download-and-prepare.ts` (Plan 1's location).
- `writeRuntimeImages` is imported from `src/gadgets/pm/core/writeRuntimeImages.ts` (this plan, task 1).

### 3. Mid-run image pickup integration test

**Tests first** (`tests/integration/gadgets/runtime-image-delivery.test.ts` — new file):

- `runtime gadget — when an image is added to the issue between two read-work-item calls, the second call delivers it on disk` — integration — first call: mock provider returns work item with 0 images; assert `readWorkItem` returns text without `.cascade/context/images/` paths. Second call: mock provider returns work item with 1 image; assert `readWorkItem` writes the image AND returns text with the local path. Expected red: today the runtime gadget writes nothing; second call returns same text-only shape.
- `runtime gadget — extension-less Linear URL flows end-to-end via the runtime path` — integration — mock provider returns `MediaReference` with `url: 'https://uploads.linear.app/<uuid>/file'` and `mimeType: 'image/*'`; mock `downloadMedia` to return `{ buffer, mimeType: 'image/png' }`; assert resulting on-disk file has `.png` extension AND the file content equals the buffer. Expected red: today the gadget doesn't write to disk at all.
- `runtime gadget — Trello PNG and JIRA attachment URLs flow through the runtime path (regression)` — integration — same as above but with extensioned URLs; assert filenames have correct extensions and writes succeed. Expected red: today the gadget doesn't write at all.

**Implementation**: covered by tasks 1 + 2 above. This task is purely integration-level coverage.

---

## Test Plan

### Unit tests
- [ ] `tests/unit/gadgets/pm/core/writeRuntimeImages.test.ts` (new): 6 tests for the writer
- [ ] `tests/unit/gadgets/pm/core/readWorkItem.test.ts`: 5 new tests for the gadget surface (extend existing if present)

### Integration tests
- [ ] `tests/integration/gadgets/runtime-image-delivery.test.ts` (new): 3 scenarios (mid-run pickup, extension-less Linear, Trello/JIRA regression)

### Acceptance tests
- [ ] AC#3: runtime gadget integration test "extension-less Linear URL via runtime path lands on disk + path in text"
- [ ] AC#4: integration test "image added mid-run is picked up on re-read"
- [ ] AC#5 (runtime): unit test "diagnostic log line emitted from runtime gadget with same prefix and shape"
- [ ] AC#2 (runtime): regression test "Trello/JIRA images via runtime path still work"

---

## Manual Verification (for `[manual]`-tagged ACs only)

n/a — all ACs auto-tested.

---

## Acceptance Criteria (per-plan, testable)

1. The runtime gadget `readWorkItem(workItemId)` returns text whose "Pre-fetched Images" section lists actual relative file paths (e.g. `.cascade/context/images/work-item-MNG-357-img-0.png`) when images are present.
2. The files at those paths exist on disk after the gadget call returns; the bytes match what `downloadMedia` returned.
3. When an image is added to a work item between two runtime gadget calls, the second call delivers it on disk; the first call does not.
4. The diagnostic log line from Plan 1 (`[image-pipeline] work-item-fetch summary`) is emitted from the runtime gadget code path with the same field schema.
5. The disk file naming convention `work-item-<workItemId>-img-<index>.<ext>` is consistent between Plan 1's boot path and Plan 2's runtime path. A regression test pins this consistency.
6. When `mimeType` was unresolved (`image/*`), the file extension falls back to `.bin` and a warn log fires; the file is still written.
7. The text response is backward-compatible: agents that don't parse the new file paths see usable text with the existing `## Description`, `## Comments`, etc. sections preserved.
8. Failed downloads are marked in the text response (not silently dropped) AND counted in the diagnostic log's `urlsFailed` field.
9. All new/modified code has corresponding tests written before the implementation.
10. `npm run build` passes.
11. `npm test` passes.
12. `npm run test:integration` passes for the new integration tests.
13. `npm run lint` passes.
14. `npm run typecheck` passes.
15. All documentation listed in this plan's Documentation Impact has been updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `CHANGELOG.md` | Entry under the next release: "PM image delivery: the runtime `cascade-tools pm read-work-item` gadget now downloads work-item images and writes them to `.cascade/context/images/work-item-<id>-img-<index>.<ext>`. The gadget's text response lists actual local file paths the agent can read with its file-read tool. Closes the mid-run image pickup gap (image added to a work item after agent boot is now delivered on the next gadget call)." |

`src/integrations/README.md` is NOT updated by this plan — Plan 1 already established the "Image delivery contract" section; this plan's changes are consistent with that contract and don't require new documentation in the provider-onboarding guide.

---

## Out of Scope (this plan)

- The boot-path MIME fix and the shared `downloadAndPrepareImages` helper — already shipped in Plan 1.
- Linear GraphQL fixture + extraction-coverage regression test (Plan 3).
- Codex / OpenCode native multimodal SDK delivery — out of scope per spec.
- Magic-byte sniffing — out of scope per spec.
- Backfilling missed screenshots for prior runs — out of scope per spec.
- Image compression / resize / format conversion — out of scope per spec.
- Dashboard surface for "image not delivered" — out of scope per spec.

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 (text contains real file paths)
- [ ] AC #2 (files exist on disk + bytes match)
- [ ] AC #3 (mid-run pickup)
- [ ] AC #4 (diagnostic log line at runtime)
- [ ] AC #5 (naming convention consistency boot/runtime)
- [ ] AC #6 (.bin fallback + warn for unresolved MIME)
- [ ] AC #7 (text shape backward-compatible)
- [ ] AC #8 (failed downloads marked + counted)
- [ ] AC #9 (TDD discipline)
- [ ] AC #10 (build)
- [ ] AC #11 (unit tests)
- [ ] AC #12 (integration tests)
- [ ] AC #13 (lint)
- [ ] AC #14 (typecheck)
- [ ] AC #15 (docs)
