import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
/**
 * Docker auth verification script.
 *
 * Reads CLAUDE_CODE_OAUTH_TOKEN env var and calls the Claude Code SDK
 * to verify that subscription auth works in a containerized environment.
 * The SDK picks up the token automatically from the environment.
 */
import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
if (!token) {
	console.error('CLAUDE_CODE_OAUTH_TOKEN env var is required');
	process.exit(1);
}

// Claude Code requires this file to skip interactive onboarding
const homeDir = process.env.HOME ?? '/root';
writeFileSync(join(homeDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }), {
	mode: 0o600,
});

console.log(`Wrote onboarding flag to ${join(homeDir, '.claude.json')}`);
console.log('Calling Claude Code SDK...');

try {
	const env: Record<string, string | undefined> = { ...process.env };
	env.NODE_OPTIONS = undefined;
	env.VSCODE_INSPECTOR_OPTIONS = undefined;

	const stream = query({
		prompt: 'Reply with exactly: AUTH_OK',
		options: {
			maxTurns: 1,
			permissionMode: 'bypassPermissions',
			allowDangerouslySkipPermissions: true,
			tools: [],
			persistSession: false,
			env,
		},
	});

	let result: SDKResultMessage | undefined;
	for await (const message of stream) {
		if (message.type === 'result') {
			result = message as SDKResultMessage;
		}
	}

	if (result?.subtype === 'success') {
		console.log('AUTH_OK - Subscription auth works in container');
		process.exit(0);
	} else {
		console.error('Auth failed:', result?.subtype);
		if (result && 'errors' in result) {
			console.error('Errors:', (result as { errors?: string[] }).errors);
		}
		process.exit(1);
	}
} catch (error) {
	console.error('SDK call failed:', error);
	process.exit(1);
}
