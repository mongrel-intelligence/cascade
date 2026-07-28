# Codex CLI JSONL fixtures

These sanitized fixtures are recordings from `codex exec --json` used to gate
worker CLI upgrades. Thread IDs are replaced with stable fixture values; event
shapes and usage counters are unchanged.

Recordings for MNG-1753 were captured on 2026-07-28:

- `exec-0.141.0.jsonl`: `@openai/codex@0.141.0`, model `gpt-5.4`, one turn.
- `exec-0.145.0.jsonl`: `@openai/codex@0.145.0`, model `gpt-5.6-sol`, followed
  by `codex exec resume` for a second turn.

The 0.145.0 recording confirms that `turn.completed.usage` remains cumulative:
input/output totals advance from `15428/6` to `30875/13`. The engine replay
test therefore expects the second persisted delta to be `15447/7`.

For future upgrades, record a minimal first turn and resumed turn with both the
old and target pins, sanitize identifiers and prompt content, then replay the
fixtures through:

```bash
npx vitest run --project unit-backends \
  tests/unit/backends/codex-jsonlParser.test.ts \
  tests/unit/backends/codex.test.ts
```

The engine replay must produce no
`Unrecognized Codex event type — no fields extracted` log entries and no
`Codex turn.completed reported lower cumulative usage` warnings.

The `write_stdin failed: stdin is closed` detector must remain independently
pinned in `codex.test.ts`. As of this recording, upstream issue
openai/codex#18578 is still open and its stderr examples retain the
`codex_core::tools::router` module path. Upstream PR openai/codex#28895 was
merged, but it hardens retry behavior for remote exec-server writes rather than
the non-TTY process path described in #18578.
