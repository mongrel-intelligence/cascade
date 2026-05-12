import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../../../src/backends/shared/nativeToolPrompts.js';

/**
 * Termination protocol guard — the shared native-tool prompt must instruct
 * every agent (regardless of role) to call `Finish` when work is done and
 * stop emitting tool calls.
 *
 * Background: MNG-699 / ucho PR #400 (2026-05-12) — respond-to-review run
 * `b728fa3e` finished its real work at 08:43:22 (commit pushed, review reply
 * posted) but kept emitting tool calls for ~32 more minutes until the user
 * cancelled at 09:15:08. Root cause: the prompt didn't mandate calling
 * `Finish`. Without an explicit instruction, the model may decide it is
 * done by emitting trailing text but never invokes the gadget that throws
 * `TaskCompletionSignal` — so the SDK keeps streaming.
 *
 * Lives in the shared `NATIVE_TOOL_EXECUTION_RULES` block (delivered via
 * `buildSystemPrompt`) rather than per-agent YAML so every agent inherits
 * it without per-yaml duplication. New agents pick it up for free.
 */
describe('termination protocol in shared system prompt', () => {
	// Minimal arguments — the per-agent body and tool list don't matter
	// for this guard. We only care that the shared rules block is present.
	const composed = buildSystemPrompt('AGENT_BODY_PLACEHOLDER', []);

	it('contains the "Termination protocol" heading', () => {
		expect(composed).toMatch(/Termination protocol/);
	});

	it('explicitly names the `Finish` gadget the agent must call', () => {
		const protocolBlock = composed.split('Termination protocol')[1] ?? '';
		expect(protocolBlock).toMatch(/\bFinish\b/);
	});

	it('forbids further tool calls after Finish succeeds', () => {
		const protocolBlock = composed.split('Termination protocol')[1] ?? '';
		expect(protocolBlock).toMatch(
			/do not.*after.*finish|no.*tool.*after.*finish|session ends|stops streaming/i,
		);
	});

	it('still includes the per-agent body after the rules block', () => {
		// Sanity: the rules don't accidentally drop the caller-supplied body.
		expect(composed).toContain('AGENT_BODY_PLACEHOLDER');
	});
});
