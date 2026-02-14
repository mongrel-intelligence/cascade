import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * Docker auth verification script.
 *
 * Reads CLAUDE_CREDENTIALS env var, installs it to a temp dir,
 * sets CLAUDE_CONFIG_DIR, then calls the Claude Code SDK to verify
 * that subscription auth works in a containerized environment.
 */
import { type SDKResultMessage, query } from '@anthropic-ai/claude-agent-sdk';

const credentials = process.env.CLAUDE_CREDENTIALS;
if (!credentials) {
	console.error('CLAUDE_CREDENTIALS env var is required');
	process.exit(1);
}

// Install credentials to temp dir (same as CASCADE's installCredentials)
const configDir = mkdtempSync(join(tmpdir(), 'cascade-claude-'));
writeFileSync(join(configDir, '.credentials.json'), credentials, { mode: 0o600 });
process.env.CLAUDE_CONFIG_DIR = configDir;

// Claude Code requires this file to skip interactive onboarding
const homeDir = process.env.HOME ?? '/root';
writeFileSync(join(homeDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }), {
	mode: 0o600,
});

console.log(`Installed credentials to ${configDir}`);
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
} finally {
	await rm(configDir, { recursive: true, force: true }).catch(() => {});
}
