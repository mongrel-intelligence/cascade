import { classifyCodexGrammarProbe, runCodexGrammarProbe } from './grammarSmoke.js';

/** Worker-image build step: fail the build when the pinned Codex CLI rejects CASCADE's argv. */
const verdict = classifyCodexGrammarProbe(await runCodexGrammarProbe());
if (!verdict.ok) {
	console.error(`codex grammar smoke check failed: ${verdict.reason}`);
	process.exit(1);
}
console.log('codex grammar smoke check passed');
