/**
 * Tmux gadget - execute shell commands in tmux sessions.
 *
 * All shell commands should be run through this gadget. It provides:
 * - No timeout issues (commands run in background tmux sessions)
 * - Initial output capture (waits up to 60s by default)
 * - Easy monitoring of long-running processes
 */
import { spawn } from 'node:child_process';
import { Gadget, z } from 'llmist';

const DEFAULT_TIMEOUT_MS = 120000; // 2 min for the gadget itself
const DEFAULT_WAIT_MS = 60000; // 60s to wait for initial output
const POLL_INTERVAL_MS = 500;

/**
 * Session name validation - alphanumeric, underscore, dash only.
 * Prevents shell injection and tmux command issues.
 */
const sessionNameSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-zA-Z0-9_-]+$/, 'Session name must be alphanumeric with underscores or dashes only');

/**
 * Helper to run tmux commands and capture output.
 */
async function runTmux(args: string[]): Promise<{ exitCode: number; output: string }> {
	return new Promise((resolve) => {
		const proc = spawn('tmux', args);
		const chunks: Buffer[] = [];
		const errChunks: Buffer[] = [];

		proc.stdout.on('data', (chunk) => chunks.push(chunk));
		proc.stderr.on('data', (chunk) => errChunks.push(chunk));

		proc.on('close', (code) => {
			const stdout = Buffer.concat(chunks).toString();
			const stderr = Buffer.concat(errChunks).toString();
			const output = [stdout, stderr].filter(Boolean).join('\n').trim();
			resolve({ exitCode: code ?? 1, output });
		});

		proc.on('error', () => {
			resolve({ exitCode: 1, output: 'Failed to spawn tmux' });
		});
	});
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

class TmuxGadget extends Gadget({
	name: 'Tmux',
	description: `Execute shell commands in tmux sessions.

**Use this for ALL shell commands** (npm, tests, builds, git, etc.)

**ACTIONS:**
- \`start\`: Run a command in a new session. Waits up to 60s for initial output.
  - If command exits quickly: returns full output + exit status
  - If still running: returns partial output + "still running" message
- \`capture\`: Get recent output from a running session
- \`send\`: Send keys/commands to a session (use "C-c" for Ctrl+C)
- \`list\`: List all active sessions
- \`kill\`: Terminate a session
- \`exists\`: Check if a session is running

**TYPICAL WORKFLOW:**
1. Start: Tmux(action="start", session="test-run", command="npm test")
2. If still running, check progress: Tmux(action="capture", session="test-run")
3. When done: Tmux(action="kill", session="test-run")

**SESSION NAMING:** Use descriptive names like "npm-install", "test-run", "lint-check", "build"`,
	timeoutMs: DEFAULT_TIMEOUT_MS,
	schema: z.discriminatedUnion('action', [
		// Start a new session with a command
		z.object({
			action: z.literal('start'),
			session: sessionNameSchema.describe("Unique session name (e.g., 'test-run', 'npm-install')"),
			command: z.string().describe("Command to run (e.g., 'npm test', 'npm install')"),
			cwd: z
				.string()
				.optional()
				.describe('Working directory for the command (default: current directory)'),
			wait: z
				.number()
				.default(DEFAULT_WAIT_MS)
				.describe('Max time to wait for initial output in ms (default: 60000)'),
		}),

		// Send keys/commands to an existing session
		z.object({
			action: z.literal('send'),
			session: sessionNameSchema.describe('Target session name'),
			keys: z.string().describe("Keys or command to send (e.g., 'npm test' or 'C-c' for Ctrl+C)"),
			enter: z.boolean().default(true).describe('Press Enter after sending keys (default: true)'),
		}),

		// Capture output from a session
		z.object({
			action: z.literal('capture'),
			session: sessionNameSchema.describe('Session to capture output from'),
			lines: z
				.number()
				.int()
				.min(1)
				.max(1000)
				.default(100)
				.describe('Number of lines to capture (default: 100, max: 1000)'),
		}),

		// List all sessions
		z.object({
			action: z.literal('list'),
		}),

		// Kill a session
		z.object({
			action: z.literal('kill'),
			session: sessionNameSchema.describe('Session to terminate'),
		}),

		// Check if session exists
		z.object({
			action: z.literal('exists'),
			session: sessionNameSchema.describe('Session name to check'),
		}),
	]),
	examples: [
		{
			params: { action: 'start', session: 'test-run', command: 'npm test', wait: 60000 },
			output:
				'session=test-run status=exited\n\n> project@1.0.0 test\n> vitest run\n\n✓ 15 tests passed',
			comment: 'Run tests - command completed within wait period',
		},
		{
			params: { action: 'start', session: 'npm-install', command: 'npm install', wait: 60000 },
			output:
				"session=npm-install status=running\n\nadded 50 packages\n\n(Process still running in session 'npm-install'. Use capture to check progress, kill when done.)",
			comment: 'npm install still running after initial wait',
		},
		{
			params: { action: 'capture', session: 'npm-install', lines: 50 },
			output: 'session=npm-install lines=50\n\nadded 874 packages in 45s',
			comment: 'Check output from running session',
		},
		{
			params: { action: 'send', session: 'dev-server', keys: 'C-c', enter: false },
			output: "session=dev-server status=sent\n\nSent keys to session 'dev-server': C-c",
			comment: 'Send Ctrl+C to stop a process',
		},
		{
			params: { action: 'kill', session: 'npm-install' },
			output: "session=npm-install status=killed\n\nSession 'npm-install' terminated",
			comment: 'Terminate a session',
		},
		{
			params: { action: 'list' },
			output: 'sessions=2\n\ntest-run: npm (running)\nnpm-install: npm (running)',
			comment: 'List all active tmux sessions',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		switch (params.action) {
			case 'start': {
				// Check if session already exists
				const checkResult = await runTmux(['has-session', '-t', params.session]);
				if (checkResult.exitCode === 0) {
					return `session=${params.session} status=error\n\nSession '${params.session}' already exists. Use action="kill" first or choose a different name.`;
				}

				// Build the command with optional cwd
				const shellCommand = params.cwd ? `cd ${params.cwd} && ${params.command}` : params.command;

				// Create new detached session with wider terminal for better output
				// Use remain-on-exit so the pane stays around after the command exits,
				// giving us time to capture output before the tmux server shuts down
				const result = await runTmux([
					'new-session',
					'-d', // detached
					'-s',
					params.session,
					'-x',
					'200', // wider terminal
					'-y',
					'50',
					'bash',
					'-c',
					// Set remain-on-exit FIRST so it applies when command exits
					`tmux set-option -t ${params.session} remain-on-exit on 2>/dev/null; ${shellCommand}`,
				]);

				if (result.exitCode !== 0) {
					return `session=${params.session} status=error\n\n${result.output || 'Failed to create session'}`;
				}

				// Wait and poll for output - capture BEFORE checking if session ended
				// to avoid race condition where server shuts down
				const waitMs = params.wait ?? DEFAULT_WAIT_MS;
				let elapsed = 0;
				let sessionEnded = false;
				let lastOutput = '';

				while (elapsed < waitMs) {
					await sleep(POLL_INTERVAL_MS);
					elapsed += POLL_INTERVAL_MS;

					// Capture output first (while session/server is still guaranteed running)
					const capture = await runTmux(['capture-pane', '-t', params.session, '-p', '-S', '-200']);
					if (capture.exitCode === 0) {
						lastOutput = capture.output;
					}

					// Check if pane has died (remain-on-exit keeps pane but marks it dead)
					const check = await runTmux([
						'display-message',
						'-t',
						params.session,
						'-p',
						'#{pane_dead}',
					]);
					if (check.exitCode !== 0 || check.output.trim() === '1') {
						sessionEnded = true;
						break;
					}
				}

				const output = lastOutput.replace(/^\s*\n/, '').replace(/\n\s*$/, '');

				if (sessionEnded) {
					// Clean up the dead session
					await runTmux(['kill-session', '-t', params.session]);
					return `session=${params.session} status=exited\n\n${output || '(no output)'}`;
				}
				return `session=${params.session} status=running\n\n${output || '(no output yet)'}\n\n(Process still running in session '${params.session}'. Use capture to check progress, kill when done.)`;
			}

			case 'send': {
				// Verify session exists
				const checkResult = await runTmux(['has-session', '-t', params.session]);
				if (checkResult.exitCode !== 0) {
					return `session=${params.session} status=error\n\nSession '${params.session}' does not exist`;
				}

				// Send keys
				const sendArgs = ['send-keys', '-t', params.session, params.keys];
				if (params.enter) {
					sendArgs.push('Enter');
				}

				const result = await runTmux(sendArgs);
				if (result.exitCode !== 0) {
					return `session=${params.session} status=error\n\n${result.output || 'Failed to send keys'}`;
				}

				const enterNote = params.enter ? ' [Enter]' : '';
				return `session=${params.session} status=sent\n\nSent keys to session '${params.session}': ${params.keys}${enterNote}`;
			}

			case 'capture': {
				// Verify session exists
				const checkResult = await runTmux(['has-session', '-t', params.session]);
				if (checkResult.exitCode !== 0) {
					return `session=${params.session} status=error\n\nSession '${params.session}' does not exist`;
				}

				// Capture pane output
				const result = await runTmux([
					'capture-pane',
					'-t',
					params.session,
					'-p', // print to stdout
					'-S',
					`-${params.lines}`, // start from N lines back
				]);

				if (result.exitCode !== 0) {
					return `session=${params.session} status=error\n\n${result.output || 'Failed to capture output'}`;
				}

				// Trim empty lines from start/end but preserve internal structure
				const captured = result.output.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
				return `session=${params.session} lines=${params.lines}\n\n${captured || '(no output yet)'}`;
			}

			case 'list': {
				const result = await runTmux([
					'list-sessions',
					'-F',
					'#{session_name}: #{pane_current_command} (#{?session_attached,attached,running})',
				]);

				if (result.exitCode !== 0) {
					// No sessions is not an error
					if (
						result.output.includes('no server running') ||
						result.output.includes('no sessions')
					) {
						return 'sessions=0\n\nNo active tmux sessions';
					}
					return `status=error\n\n${result.output}`;
				}

				const sessions = result.output.split('\n').filter(Boolean);
				return `sessions=${sessions.length}\n\n${sessions.join('\n') || 'No active sessions'}`;
			}

			case 'kill': {
				// Verify session exists first
				const checkResult = await runTmux(['has-session', '-t', params.session]);
				if (checkResult.exitCode !== 0) {
					return `session=${params.session} status=error\n\nSession '${params.session}' does not exist`;
				}

				const result = await runTmux(['kill-session', '-t', params.session]);
				if (result.exitCode !== 0) {
					return `session=${params.session} status=error\n\n${result.output || 'Failed to kill session'}`;
				}

				return `session=${params.session} status=killed\n\nSession '${params.session}' terminated`;
			}

			case 'exists': {
				const result = await runTmux(['has-session', '-t', params.session]);
				const exists = result.exitCode === 0;
				return `session=${params.session} exists=${exists}\n\nSession '${params.session}' ${exists ? 'exists and is running' : 'does not exist'}`;
			}

			default:
				return 'status=error\n\nUnknown action';
		}
	}
}

// Export the class for use in agent builder
export { TmuxGadget as Tmux };
