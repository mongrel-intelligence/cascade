---
id: 013
slug: subprocess-output-streaming
plan: 1
plan_slug: observable-subprocess-helper
level: plan
parent_spec: docs/specs/013-subprocess-output-streaming.md
depends_on: []
status: pending
---

# 013/1: Observable subprocess helper

> Part 1 of 1 in the 013-subprocess-output-streaming plan. See [parent spec](../../specs/013-subprocess-output-streaming.md).

## Summary

This plan is the full execution of spec 013. One cohesive change: replace the hand-rolled `spawn`-based `runCommand()` in `src/utils/repo.ts` with an `execa`-backed implementation that streams child output to the parent's stderr as it arrives, emits a heartbeat line every 30s during child silence, kills the child (and its descendants) on either an idle-silence timeout or a wall-clock timeout via a SIGTERM→SIGKILL ladder, and preserves captured stdout/stderr in the returned result on both success and failure. A second, trivially-adjacent change updates `bin/cascade-tools.js` to exclude `bootstrap.js` from the oclif command-loader glob, silencing the `command bootstrap not found` warning.

**Value ships:** agents watching cascade-tools output stop perceiving long `git push`/hook runs as hangs; cascade-tools emits live progress and enforces clean termination for actually-stuck children; operator log output is cleaner. All nine spec ACs land here (AC 9 is `[manual]`).

**What this plan does NOT change:** the `runCommand()` exported signature's existing fields (`{ stdout, stderr, exitCode }`) — they continue to appear in the result object (we only add an optional `reason` field for termination cause). No caller is required to pass the new `options` arg; defaults cover every existing callsite. Gadget-level 240s timeout and the dashboard/router/worker paths are untouched.

**Components delivered:**
- `package.json` — add `execa` and `tree-kill` to `dependencies`
- `src/utils/repo.ts` — full rewrite of `runCommand()` on top of execa; new exported `RunCommandOptions` type; new optional `reason` field on result
- `src/gadgets/github/core/createPR.ts` — `pushBranch()` and `stageAndCommit()` pass explicit tighter timeouts (push waits up to the gadget's 240s ceiling); success path returns captured hook output instead of dropping it
- `bin/cascade-tools.js` — append `!bootstrap.js` to oclif `globPatterns`
- `tests/unit/utils/repo.test.ts` — retool existing mocks (spawn → execa), add tests for streaming, heartbeat, idle timeout, wall timeout, tree-kill, kept-output-on-success
- `tests/unit/gadgets/github/core/createPR.test.ts` — add assertions that pushBranch/stageAndCommit pass explicit timeout options and that success-path result exposes hook output

**Deferred to later plans in this spec:**
- None — 1-plan spec.

---

## Spec ACs satisfied by this plan

- Spec AC #1 (live stderr streaming during hook runs) — **full**
- Spec AC #2 (30s heartbeat on silence) — **full**
- Spec AC #3 (idle-timeout kill with SIGTERM→SIGKILL) — **full**
- Spec AC #4 (wall-clock kill with SIGTERM→SIGKILL) — **full**
- Spec AC #5 (descendant / process-group kill) — **full**
- Spec AC #6 (captured output preserved on success + failure) — **full**
- Spec AC #7 (oclif `command bootstrap not found` warning gone) — **full**
- Spec AC #8 (backward-compat result shape for all existing callers) — **full**
- Spec AC #9 (agent end-to-end sees hook progress ≤30s, no retry loop) — **full `[manual]`** — see Manual Verification section

---

## Depends On

None. Plan depends only on cascade's existing test + build toolchain and a working network for `npm install`.

---

## Detailed Task List (TDD)

### 1. Add `execa` and `tree-kill` dependencies

**No tests for this step directly** — dependency presence is verified indirectly by the helper tests below.

**Implementation** (`package.json`):
- Add `"execa": "^9.6.1"` to `dependencies`
- Add `"tree-kill": "^1.2.2"` to `dependencies`
- Add `"@types/tree-kill": "^1.2.2"` to `devDependencies` (tree-kill ships CJS; types live under `@types`)
- Run `npm install` and commit the updated `package-lock.json`

---

### 2. Rewrite `runCommand()` on execa

**Tests first** (`tests/unit/utils/repo.test.ts`):

Retool the existing `vi.mock('node:child_process', ...)` block: keep it for residual callsites but remove the `spawn` mock and switch the `runCommand` tests to mock `execa` and `tree-kill` directly. Use `vi.mock('execa', ...)` returning a fake subprocess whose `stdout` / `stderr` are `Readable` streams the test can push to, with a `pid` number and a `then(...)` resolver representing the await of the subprocess. Use `vi.mock('tree-kill', ...)` returning a mock function.

For each test specify name, type, setup, expected outcome, AND expected red.

- `streams child stdout to parent stderr line-by-line as it arrives` — unit — mock execa subprocess pushes `"line1\n"`, then `"line2\n"` to `stdout`; spy on `process.stderr.write`; await helper call → both lines appear on the spy in order, BEFORE the subprocess resolves. Expected red: `AssertionError: expected process.stderr.write to have been called with "line1\n" but it was called [] (0 times)`.
- `streams child stderr to parent stderr line-by-line` — unit — same shape as above but push to child `stderr` → parent stderr receives. Expected red: `AssertionError: expected process.stderr.write to have been called with "err1\n" but it was called [] (0 times)`.
- `emits a heartbeat to parent stderr after N ms of child silence, citing elapsed time and command label` — unit — `vi.useFakeTimers()`; call helper with `heartbeatMs: 1000` and a label; subprocess emits no data; advance timers by 1000ms → a line matching `/\[git-push\] still running \(1s\)/` appears on parent stderr. Expected red: `AssertionError: expected process.stderr.write to have been called with match(/\[git-push\] still running/) but it was not`.
- `resets the heartbeat timer when child emits output` — unit — fake timers; `heartbeatMs: 1000`; advance 900ms (no heartbeat yet); subprocess pushes `"tick\n"`; advance 1000ms more → only one heartbeat fires total (at 1900ms cumulative), not two. Expected red: `AssertionError: expected 1 heartbeat, got 2 (heartbeat at 1000ms was not cancelled by child output at 900ms)`.
- `does not emit heartbeat when child exits before heartbeatMs elapses` — unit — `heartbeatMs: 10_000`; subprocess resolves after 100ms → zero heartbeat lines. Expected red: `AssertionError: expected 0 heartbeats, got 1`.
- `kills the child via tree-kill with SIGTERM when idleTimeoutMs elapses with no output` — unit — fake timers; `idleTimeoutMs: 5000`; no child output; advance timers by 5000ms → tree-kill mock called with `(pid, 'SIGTERM')`; result `reason` is `'idle-timeout'`; `exitCode` is non-zero. Expected red: `AssertionError: expected tree-kill to have been called with ["<pid>", "SIGTERM"] but was not called`.
- `escalates to SIGKILL after forceKillAfterMs if the child did not exit on SIGTERM` — unit — fake timers; idle-timeout fires SIGTERM; advance another 5000ms without the child exiting → tree-kill called a second time with `(pid, 'SIGKILL')`. Expected red: `AssertionError: expected tree-kill to be called 2 times (SIGTERM then SIGKILL), was called 1 time`.
- `kills the child via tree-kill with SIGTERM when wallTimeoutMs elapses even with ongoing output` — unit — fake timers; `wallTimeoutMs: 5000`, `idleTimeoutMs: 100_000`; subprocess pushes data every 500ms (resets idle timer); advance 5000ms → tree-kill called with SIGTERM; result `reason` is `'wall-timeout'`. Expected red: `AssertionError: expected reason: "wall-timeout", got undefined (wall-clock timer not armed or not firing under fake-timer advance)`.
- `returns captured stdout and stderr in the result on success` — unit — subprocess pushes `"ok\n"` on stdout then resolves with exit 0 → result is `{ stdout: "ok\n", stderr: "", exitCode: 0 }`. Expected red: `AssertionError: expected result.stdout to equal "ok\n", got "" (capture discarded)`.
- `returns captured stdout and stderr in the result on non-zero exit` — unit — subprocess pushes `"failed\n"` on stderr then resolves with exit 1 → result exposes stderr contents AND exitCode 1. Expected red: `AssertionError: expected result.exitCode to equal 1, got 0` (or capture-discard variant).
- `does not stream when options.silent is true` — unit — subprocess pushes data; spy on `process.stderr.write` → zero forwarded lines (heartbeat-suppression is a separate option but silent also suppresses streaming). Expected red: `AssertionError: expected process.stderr.write 0 calls, got 1`.
- `backward-compatible signature: runCommand(cmd, args, cwd) returns { stdout, stderr, exitCode }` — unit — no options arg; mock subprocess; result has exactly the three-field shape plus optional `reason` undefined. Expected red: `TypeError: options is not defined` or shape-mismatch assertion.

**Implementation** (`src/utils/repo.ts`):

Replace the current `runCommand()` body (lines 70–103) with an execa-based implementation. Keep the existing exported signature; extend with a fifth optional `options` arg.

- New exported type:

```ts
export type RunCommandOptions = {
  /** Emit a heartbeat on parent stderr every N ms of child silence. Default 30_000. Set to 0 to disable. */
  heartbeatMs?: number;
  /** Kill child if no output for N ms. Default 120_000. Set to 0 to disable. */
  idleTimeoutMs?: number;
  /** Kill child after N ms of total runtime. Default 600_000. Set to 0 to disable. */
  wallTimeoutMs?: number;
  /** After SIGTERM, wait N ms before SIGKILL. Default 5_000. */
  forceKillAfterMs?: number;
  /** Short label emitted in heartbeat lines. Defaults to `command`. */
  label?: string;
  /** Suppress streaming and heartbeats. Capture-only. Default false. */
  silent?: boolean;
};

export type RunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Set when the child was killed by the helper's timeouts. Undefined on natural exit. */
  reason?: 'idle-timeout' | 'wall-timeout';
};
```

- Signature:

```ts
export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
  options?: RunCommandOptions,
): Promise<RunCommandResult>
```

- Internals:
  - Spawn via `execa(command, args, { cwd, env: { ...process.env, ...env }, all: false, reject: false })`. `reject: false` makes execa return a `SubprocessResult` even on non-zero exits, matching the current contract.
  - If `!silent`, attach listeners on `subprocess.stdout` and `subprocess.stderr` that (a) append chunks to capture buffers AND (b) write them to `process.stderr` as they arrive, and (c) reset the idle-timer.
  - If `silent`, capture only; don't stream; don't heartbeat.
  - Heartbeat: `setInterval` with `heartbeatMs` (default 30_000). Each tick checks "was there child output since the last tick?"; if not, write `[<label>] still running (<elapsed>s)\n` to `process.stderr`. Elapsed is rounded whole seconds since helper start.
  - Idle timer: `setTimeout` with `idleTimeoutMs` (default 120_000), re-armed on every child-output chunk. On fire: call `tree-kill(subprocess.pid, 'SIGTERM')`, schedule `tree-kill(subprocess.pid, 'SIGKILL')` after `forceKillAfterMs` (default 5_000), set `reason = 'idle-timeout'`.
  - Wall timer: `setTimeout` with `wallTimeoutMs` (default 600_000), NOT reset on child output. On fire: same termination sequence, set `reason = 'wall-timeout'`. If idle fires first, cancel wall; and vice versa.
  - On natural `subprocess` resolution: clear all timers and intervals.
  - Return `{ stdout, stderr, exitCode, reason }` where `exitCode` is the actual child exit code (or `-1` if killed by SIGKILL and execa surfaces a signal instead of a code — map to non-zero).

- Do not change `cleanupTempDir`, `createTempDir`, or any other function in this file.

**Leave room for refactor on green** (per TDD anti-patterns): the `Implementation` specifies the CONTRACT and observable behavior, not every line. If `/implement` finds a cleaner arrangement (e.g., lifting the timer bundle into a small helper class) during refactor-on-green, it should do so.

---

### 3. Tighten timeouts on slow callsites in `createPR`

**Tests first** (`tests/unit/gadgets/github/core/createPR.test.ts`):

Add to the existing test file (do not create a new one). Mock the `runCommand` import at the top of the file.

- `pushBranch passes an explicit wallTimeoutMs below the gadget's 240s ceiling` — unit — call `createPR()` with the push path reaching `pushBranch`; assert `runCommand` mock was called for `['git', 'push', ...]` with a 5th-arg options object whose `wallTimeoutMs` is ≤ 230_000. Expected red: `AssertionError: expected runCommand to be called with options.wallTimeoutMs ≤ 230000, got undefined`.
- `pushBranch passes an explicit idleTimeoutMs` — unit — same shape; assert options `idleTimeoutMs` is a finite number (e.g., 90_000). Expected red: `AssertionError: expected options.idleTimeoutMs to be a number, got undefined`.
- `pushBranch result carries the captured hook output even on success` — unit — mock `runCommand` to resolve `{ stdout: "hook stdout", stderr: "hook stderr", exitCode: 0 }`; drive `createPR`; assert the result object exposes (via an added field on `CreatePRResult`, e.g., `pushOutput`) the captured stdout+stderr. Expected red: `AssertionError: expected result.pushOutput to be defined, got undefined`.
- `stageAndCommit result carries the captured hook output even on success` — unit — same shape for the commit path via `commitOutput`. Expected red: as above.

**Implementation** (`src/gadgets/github/core/createPR.ts`):
- `pushBranch()`: pass `{ label: 'git-push', wallTimeoutMs: 230_000, idleTimeoutMs: 90_000 }` to `runCommand`. On success, return the captured `{ stdout, stderr }` to the caller rather than discarding.
- `stageAndCommit()`: pass `{ label: 'git-commit', wallTimeoutMs: 120_000, idleTimeoutMs: 60_000 }`. On success, return captured output.
- Extend the `CreatePRResult` type with optional `pushOutput?: string` and `commitOutput?: string`. Populate them in `createPR()` from the two helpers' captured output. The sidecar writer preserves whatever fields are present — no schema change to the sidecar needed.
- Leave the fast callsites (`git remote get-url`, `git add`, `git status`, `git ls-remote`, `git ls-files`) with NO options arg. Defaults cover them.

---

### 4. Exclude bootstrap.js from oclif command glob

**Tests first** — there is no unit test for an oclif config one-liner; rely on the build + a smoke check in Manual Verification.

**Implementation** (`bin/cascade-tools.js`):
- Current: `globPatterns: ['**/*.js', '!**/dashboard/**', '!**/_shared/**', '!base.js']`
- After: `globPatterns: ['**/*.js', '!**/dashboard/**', '!**/_shared/**', '!base.js', '!bootstrap.js']`

Single-character diff. Do not move or rename `src/cli/bootstrap.ts`; its side-effect import from `bin/cascade-tools.js` line 11 is load-bearing and must continue to fire.

---

### 5. Adjust existing tests that still mock `spawn` via the shared helper

If any other existing test in `tests/unit/` breaks because it was asserting the old buffered-capture behavior (e.g., expecting zero writes to parent stderr), update those tests to accommodate the new default of streaming-on. Do not change the tests' underlying intent; just align expectations.

- `tests/unit/agents/utils/setup.test.ts` — uses `runCommand` for bash setup-script; if it asserted on `process.stderr`, add the expected forwarded content.
- `tests/unit/agents/shared/repository.test.ts` — uses `runCommand` for fetch/checkout/rev-parse/reset; same adjustment.
- `tests/unit/gadgets/github.test.ts` — if it asserts createPR flow.

Only change what's necessary; no structural refactors.

---

### 6. Documentation updates

**Implementation**:

- `README.md` — in the relevant "what cascade-tools provides" or dependency mention, add a short note: "As of spec 013, cascade-tools streams all subprocess output live to parent stderr, emits heartbeats on silence, and enforces idle + wall-clock timeouts with process-group kill."
- `docs/cascade-directory.md` — under the `setup.sh` / `ensure-services.sh` discussion (or add a short new subsection), clarify that cascade-tools streams hook output live and has a per-subprocess wall-clock timeout independent of the gadget 240s; if a hook genuinely hangs, it will be killed after the idle-silence timeout.
- `CHANGELOG.md` — add an entry under the next unreleased section: "Spec 013: `cascade-tools` subprocess helper now streams child output live, emits 30s-silence heartbeats, enforces idle + wall-clock timeouts with process-group kill, and preserves captured hook output on success; oclif `command bootstrap not found` warning silenced."

---

## Test Plan

### Unit tests
- [ ] `tests/unit/utils/repo.test.ts`: 12 retooled/new tests covering streaming, heartbeat, idle timeout, wall timeout, tree-kill, force-kill escalation, capture preservation, silent mode, backward-compat signature
- [ ] `tests/unit/gadgets/github/core/createPR.test.ts`: 4 new assertions for pushBranch/stageAndCommit options + captured-output-on-success
- [ ] Existing test alignment in `tests/unit/agents/utils/setup.test.ts`, `tests/unit/agents/shared/repository.test.ts`, `tests/unit/gadgets/github.test.ts` as needed

### Integration tests
- None directly added by this plan. Cascade's existing integration suite exercises `runCommand` through real subprocess invocations on the integration-test DB; if any integration test asserts on stderr absence during a `runCommand` call, update as needed in step 5.

### Acceptance tests
- AC #1–#8 covered by the unit test battery above.
- AC #9 is `[manual]` — see Manual Verification below.

---

## Manual Verification (for `[manual]`-tagged ACs only)

- **AC**: spec AC #9 (end-to-end agent behavior: agent sees hook progress within ~30s and does not enter a retry loop)
- **Why manual**: requires triggering a real CASCADE agent run against a target repo with a multi-second pre-push hook and observing the agent's `Monitor` tool output file over time. Cascade's unit and integration suites do not exercise LLM-agent behavior.
- **Verification protocol**:
  1. Ensure cascade's dev router + dashboard are running locally, and that the `ucho` project is registered with its GitHub tokens and Linear credentials.
  2. Create or identify a Linear issue on the `ucho` team tagged to trigger the `implementation` agent (any simple change — e.g., "update a README typo"). Move the issue to the trigger status.
  3. The CASCADE router enqueues the run; a worker picks it up.
  4. In a separate shell, monitor the run: `~/Code/cascade/bin/cascade.js runs logs <runId>` — follow the `cascadeLog` output.
  5. When the agent reaches the `cascade-tools scm create-pr` step, observe in the log:
     - Within the first ~10s after the tool call, the child's stdout/stderr from `git push` and the pre-push hook start appearing on stderr in the run log (e.g., `Starting pre-push hook`, `typecheck…`, `test:run…`).
     - If the hook has a silent stretch, a heartbeat line in the form `[git-push] still running (30s)` (or similar) appears every ~30s.
     - The agent does NOT retry `cascade-tools scm create-pr`; the tool call completes in a single invocation.
     - The PR is successfully created; its URL appears on stdout in the final `{ success: true, data: { prUrl: ... } }` line.
  6. Mark AC #9 verified if all four observable outcomes in step 5 are met.

If any fail, do not mark verified; investigate root cause and file a follow-up.

---

## Acceptance Criteria (per-plan, testable)

1. `runCommand()` streams child stdout and stderr to parent stderr as they arrive (tested).
2. `runCommand()` emits a heartbeat line to parent stderr after `heartbeatMs` ms of child silence, including the command label and elapsed seconds; resets on child output (tested).
3. `runCommand()` kills the child (and its process tree) via `tree-kill` SIGTERM when `idleTimeoutMs` elapses without output, escalates to SIGKILL after `forceKillAfterMs`, and returns `reason: 'idle-timeout'` (tested).
4. `runCommand()` kills the child (and its process tree) on `wallTimeoutMs` elapsed and returns `reason: 'wall-timeout'`, regardless of ongoing output (tested).
5. `runCommand()` preserves captured stdout and stderr in its return on both success and non-zero exit; `silent: true` suppresses streaming/heartbeats but not capture (tested).
6. `runCommand()` is backward-compatible: callers that pass no `options` receive `{ stdout, stderr, exitCode }` (tested).
7. `pushBranch()` passes `wallTimeoutMs ≤ 230_000` and a finite `idleTimeoutMs`; returns captured hook output on success path (tested).
8. `stageAndCommit()` passes explicit timeouts and returns captured output (tested).
9. Running `cascade-tools --help` or any other subcommand produces no `@oclif … command bootstrap not found` warning on stderr (verified via a simple post-build smoke script or manual invocation — documented in Manual Verification).
10. All new/modified code has corresponding tests.
11. `npm run build` passes.
12. `npm test` passes (all 4 unit projects).
13. `npm run typecheck` passes.
14. `npm run lint` passes.
15. All documentation listed in Documentation Impact has been updated.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `README.md` | Add short note about cascade-tools' live-streaming + heartbeat + timeout behavior in the relevant architecture/cascade-tools section |
| `docs/cascade-directory.md` | Clarify that cascade-tools streams hook output live; note the idle- and wall-clock termination guarantees from cascade's side |
| `CHANGELOG.md` | Unreleased entry: "spec 013: observable subprocess helper" with a one-paragraph summary of new default behavior |

---

## Out of Scope (this plan)

- Auditing or replacing direct `execSync` / `spawnSync` callsites outside the shared subprocess helper (spec Out of Scope).
- Lefthook / target-repo hook configuration (spec Out of Scope).
- Dashboard, router, worker, or gadget-level timeout changes (spec Non-goals).
- Windows platform support (spec Out of Scope).
- TUI progress UIs (spec Non-goals).
- Changing the gadget success/error JSON shape emitted on stdout (spec Non-goals).

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
