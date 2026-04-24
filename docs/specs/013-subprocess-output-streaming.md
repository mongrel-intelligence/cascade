---
id: 013
slug: subprocess-output-streaming
level: spec
title: Live subprocess output + heartbeats + idle-timeout in cascade-tools
created: 2026-04-24
status: draft
---

# 013: Live subprocess output + heartbeats + idle-timeout in cascade-tools

## Problem & Motivation

An LLM-driven CASCADE agent inside a worker container shells out to `cascade-tools` for git operations. When the agent runs something that triggers user-defined git hooks — most commonly `cascade-tools scm create-pr`, which invokes `git push` and thereby the target repo's `pre-push` hook — the child process may take tens of seconds (typecheck + unit tests are common). Throughout that time, the agent sees **nothing**: no stdout, no stderr, no log lines, an empty output file.

The agent is watching the output file via its `Monitor` tool. An empty file for 60 seconds is indistinguishable from "hung subprocess". The agent reaches that conclusion, kills its own wrapper, retries, sometimes retries again, and burns 5–10 minutes of its 30-minute budget before giving up or completing the task late. This reliably takes runs over the wire.

Two recent failed CASCADE runs on the `ucho` project isolated the cause:

- **MNG-287** (`f60a8ae6`): `implementation` agent timed out at 29m59s. Core loss: push silent during lefthook's `pnpm typecheck` + `pnpm test:run` (~60s), then the push eventually failed on an unrelated `git diff HEAD main` lefthook config issue. The silence multiplied the cost of the failure.
- **MNG-290** (`32f81472`): `implementation` agent editing README.md completed all code changes, ran checks clean, then hung for 7+ minutes on `cascade-tools scm create-pr`. The agent spent dozens of tool calls reading an empty output file, trying alternate invocations, checking git state, never realizing the push was actually progressing.

Tracing the cascade-tools code path: the shared subprocess helper fully buffers child stdout and stderr into in-memory strings and emits them to the caller **only when the subprocess exits**. On the success branch, captured output is **discarded entirely** — agents never see what the hook actually ran. There is also no per-subprocess wall-clock timeout and no kill-on-silence; the only timeout is a gadget-level 240s that doesn't actually kill the child.

This spec turns the subprocess path from a silent black box into an observable pipe with sane liveness and termination semantics.

---

## Goals

- A CASCADE agent watching `cascade-tools`'s output file sees live, line-buffered subprocess output for any command cascade-tools shells out to — git, installers, test runners invoked via hooks, etc.
- During stretches where the subprocess emits nothing, cascade-tools surfaces a human-readable heartbeat (elapsed time + command identifier) to stderr at a regular cadence so the agent can distinguish "still working" from "genuinely hung".
- Subprocesses that produce no output for too long are terminated cleanly (SIGTERM with an escalation to SIGKILL) rather than waiting for an outer wall-clock or hanging the agent's entire run.
- Subprocesses that exceed a wall-clock budget are also terminated cleanly, with the same escalation path.
- Process-group termination: killing a subprocess also kills its descendants (relevant because hooks spawn subshells that spawn test runners that spawn more processes).
- After a long subprocess finishes — success or failure — the captured output is preserved in the gadget's result, not silently dropped.
- Cosmetic: stop emitting the oclif `command bootstrap not found` warning on every invocation. It's unrelated noise that adds confusion to failure-triage log excerpts.

---

## Non-goals

- Rewriting gadget-level timeout semantics or the 240s gadget budget.
- Adding a TTY-style progress UI (spinners, bars). Output is a plain file read by an LLM; human-style TUI is out of scope.
- Persisting full subprocess transcripts to long-term storage. Preservation is per-call, in the returned result.
- Changing the shape of gadget success/error JSON on stdout. The final `{ success, data }` line stays on stdout; streaming goes to stderr.
- Auditing every shell-out in cascade to see whether it should go through the shared subprocess wrapper. The shared wrapper is the target of this spec; direct `execSync` / `spawnSync` callsites found along the way are out of scope unless trivially adjacent.
- Solving LLM-agent timeouts in general. This spec solves the "cascade-tools appears hung" failure mode; other agent flakiness is separate.

---

## Constraints

- Must work in the CASCADE worker container today: Node 22, Debian 12 bookworm, non-root `node` user with passwordless sudo.
- Must not break the existing gadget result contract. Every current caller reading `{ stdout, stderr, exitCode }` continues to work; streaming is additive.
- Must not corrupt the final-line stdout JSON that the gadget factory emits. Streaming goes to stderr so stdout-parsers aren't affected.
- Process-group kill must be cross-platform enough to work on Linux workers and MacOS dev machines (Windows is not a cascade deployment target).
- Dependency budget: acceptable to add two small, well-maintained npm packages. Not acceptable to add a heavy framework.
- Backward compatibility: existing tests that assert on `runCommand` result shape must continue to pass without refactoring, other than adjustments to account for new default behavior where it legitimately changes observable output (e.g. stderr now includes forwarded child output during the call).

---

## User stories / Requirements

1. **As the CASCADE agent running `cascade-tools scm create-pr` on a repo with slow pre-push hooks**, I see hook output line-by-line as it is produced so I can distinguish progress from hang.
2. **As the CASCADE agent**, during silent stretches I see a heartbeat entry on stderr every ~30 seconds including elapsed time and a short command identifier, so my `Monitor` tool does not misread silence as failure.
3. **As the CASCADE agent waiting on a genuinely stuck subprocess**, the subprocess is killed after a configurable idle period (no output for N seconds), and the kill propagates to descendants so no zombies remain.
4. **As the CASCADE agent waiting on a subprocess that is actively emitting output but has exceeded its overall budget**, the subprocess is killed at the wall-clock boundary with the same descendant-kill guarantee.
5. **As an operator reading cascade-tools logs after a successful push**, I can see what the hook actually ran — the captured output is available in the result, not discarded.
6. **As an operator invoking `cascade-tools` for any subcommand**, I do not see an `@oclif command bootstrap not found` warning preceding my output. The warning is gone.

---

## Research Notes

- **Idle-timeout is the canonical CI-runner solution to the silent-subprocess problem.** Travis CI kills builds that produce no output for 10 min and provides `travis_wait` to emit keepalive dots when a user knows a command will be quiet (Travis CI [common build problems](https://docs.travis-ci.com/user/common-build-problems/#build-times-out-because-no-output-was-received)). Buildkite and CircleCI use the same no-output-kill pattern. GitHub Actions doesn't need it because its runner agent streams logs live. An LLM agent watching a file is functionally the same problem Travis solves: needs line-buffered forwarding plus optional heartbeat on quiet.
- **`execa` (Sindre Sorhus / ehmicky)** is the de-facto Node subprocess library: ~140M downloads/month, MIT, streams by default, tee-to-terminal pattern via `stdout: ['pipe', 'inherit']`, built-in SIGTERM→SIGKILL ladder via `forceKillAfterDelay`. Termination docs: [execa/docs/termination.md](https://github.com/sindresorhus/execa/blob/main/docs/termination.md). Streaming: [execa/docs/streams.md](https://github.com/sindresorhus/execa/blob/main/docs/streams.md). Solves ~90% of what this spec needs.
- **`tree-kill`** is the canonical cross-platform process-tree killer for Node; necessary because Node's built-in single-process kill only signals the direct child, and lefthook / test-runner chains create deep process trees. Pair with execa.
- **Heartbeat-on-silence is the custom piece.** execa doesn't emit one; it must be implemented on top as a `setInterval` that fires only when no child output has flushed since the last tick. Straightforward but needs care in test doubles.

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|------|--------|----------|--------|
| [`execa`](https://github.com/sindresorhus/execa) | Subprocess spawning with streaming + kill-ladder + encoding + cross-platform quoting | **Use** | Industry default; owners maintain most of Node's subprocess tooling. Streaming and `forceKillAfterDelay` cover the primary goals out of the box. |
| [`tree-kill`](https://github.com/pkrumins/node-tree-kill) | Cross-platform process-tree termination | **Use** | Node's built-in single-process kill doesn't reach grandchildren; hooks spawn grandchildren; without this, SIGTERM of the git process leaves orphaned test runners. |
| `nano-spawn`, `tinyspawn`, `zx`, `listr2`, `ora` | Alternative subprocess / task-runner tools | **Skip** | `nano-spawn` / `tinyspawn` are minimalist replacements — not worth trading execa's battle-testing for a few KB. `zx` is a shell DSL, wrong abstraction. `listr2` / `ora` need a TTY; output sink here is a file read by an LLM. |
| Custom heartbeat ticker | Periodic "still alive" line when child is silent | **Build** | Not available in any library at the granularity this spec needs (per-subprocess, cadence-configurable, idle-aware). Thin wrapper on `setInterval`. |

---

## Strategic decisions

1. **Adopt `execa` + `tree-kill` rather than extend the hand-rolled subprocess wrapper.** Rebuild the shared subprocess helper on top of execa. Reason: streaming, kill-ladder, and encoding handling are all bug-prone when home-rolled, and execa has solved them in the wild for years. Dependency cost is small (two packages, tiny total footprint) and matches the kind of infra dep cascade already uses.
2. **Enforce BOTH wall-clock and idle-silence timeouts.** Wall-clock (per-caller, default near the gadget 240s ceiling) is the outer safety net. Idle-silence (per-caller, default in the tens of seconds) catches genuinely wedged children early instead of burning the full wall-clock. A subprocess that emits anything on any tick resets the idle timer. Both terminations go through the SIGTERM→SIGKILL ladder with process-group kill.
3. **Heartbeat cadence: 30 seconds of silence.** Frequent enough that the agent sees activity inside a typical test-suite run, infrequent enough to avoid spamming short commands (which complete before the first heartbeat ever fires). Configurable per-call; 30s is the default.
4. **Apply live streaming + heartbeat + idle-timeout to every caller of the shared subprocess helper.** Not scoped to just `git push`. Clone, fetch, checkout, setup-script invocation, and any future callsite all benefit; the cost on fast callsites (ms-scale operations) is zero because the heartbeat never fires and streaming is a no-op on empty output. Per-caller timeouts and heartbeat interval are configurable with safe defaults; callers who want different numbers set them.
5. **Stream to stderr; keep stdout pristine for the final JSON result line.** The gadget factory emits `{ success, data }` as a single JSON line on stdout at the end. Streaming subprocess output to stdout would corrupt parsers. Stderr is the conventional place for progress, and agents reading the output file can see both streams.
6. **Preserve captured output in the returned result on both success and failure.** Today, a successful `git push` throws away the hook output. Keeping it gives agents and operators post-hoc insight without re-running anything.
7. **Silence the `oclif command bootstrap not found` warning via the command-loader glob**, not by renaming or relocating the bootstrap module. The module's side-effect import at the entry point is load-bearing (it registers all integrations before oclif starts); excluding it from the command glob is the single-line change. Renaming touches more code and risks breaking the side-effect order.

---

## Acceptance Criteria (outcome-level)

1. Running any `cascade-tools` subcommand that invokes git against a repo with a slow pre-push hook produces incremental stderr output visible in the process's output file while the hook runs, not only at exit.
2. During any stretch where the subprocess emits no output for ≥30 seconds, cascade-tools writes a heartbeat line to stderr identifying the command and cumulative elapsed time, and continues writing one heartbeat every further 30 seconds of silence until output resumes or the command terminates.
3. A subprocess that emits nothing for longer than its configured idle-silence timeout is terminated with SIGTERM and escalated to SIGKILL if it does not exit within a short grace window. The cascade-tools invocation returns a non-zero exit code with both the captured output and a clear error indicating idle timeout.
4. A subprocess that exceeds its configured wall-clock timeout is terminated with the same SIGTERM→SIGKILL escalation and returns a non-zero exit code with captured output and a clear wall-clock error.
5. Termination of a subprocess kills its descendants. No processes spawned by the subprocess (test runners, subshells, etc.) survive after cascade-tools returns.
6. `cascade-tools scm create-pr` — or any gadget that pushes — returns captured stdout/stderr in its result on both success and failure paths. A successful push that ran a hook preserves the hook's output.
7. `cascade-tools --help`, `cascade-tools scm create-pr`, and every other cascade-tools invocation emit **no** `@oclif … command bootstrap not found` warning at startup.
8. All existing integration points that call the shared subprocess helper (clone, fetch, checkout, setup-script, git push, git commit, git status, ls-remote, and any other current callsites) continue to receive an equivalent `{ stdout, stderr, exitCode }` result shape, with behavior unchanged aside from the new default of live streaming to stderr and heartbeat emission on silence.
9. A CASCADE agent triggered on a ucho-style project that runs a full `cascade-tools scm create-pr` end-to-end sees pre-push hook progress within the first ~30 seconds and does not enter a retry loop on Monitor tool output. `[manual]` — verification requires running an actual agent run against a repo with a multi-second pre-push hook; end-to-end agent behavior isn't exercised by cascade's unit or integration suite.

---

## Documentation Impact (high-level)

- `README.md` — note the new dependency line (execa + tree-kill) under the library section if one exists, or add one; reference the new observable-subprocess behavior in any "debugging cascade-tools" section.
- `docs/cascade-directory.md` — the existing `.cascade/` hook reference may mention hook timeout guarantees from cascade's side; update or add a short paragraph clarifying that cascade-tools now streams hook output live and enforces both wall-clock and idle timeouts.
- `CHANGELOG.md` — entry for the observable-subprocess change and the oclif warning removal. Operator-visible; worth calling out.

---

## Out of Scope

- Lefthook configuration inside target repositories. The `main`-reference issue observed in MNG-287 is a separate concern for the target repo's hook config, not cascade-tools.
- Auditing direct `execSync` / `spawnSync` uses elsewhere in the cascade codebase. The shared subprocess helper is the target here; ad-hoc callsites are a different workstream.
- Agent-side retry policy. Whether a CASCADE agent retries a seemingly-hung cascade-tools invocation is a property of the agent; this spec reduces the false-positive rate by making subprocesses actually observable, but agent retry logic is not changed here.
- TUI progress UIs for interactive human users. The output sink is a file; optimize for that reader.
- Platform support for Windows workers. Cascade workers run on Linux; MacOS dev machines are the only non-Linux target and `tree-kill` covers it.
- Dashboard or router behavior. This spec is entirely inside cascade-tools.
