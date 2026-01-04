/**
 * Tmux gadget - execute commands in tmux sessions.
 *
 * All commands should be run through this gadget. It provides:
 * - No timeout issues (commands run in background tmux sessions)
 * - Initial output capture (waits up to 60s by default)
 * - Easy monitoring of long-running processes
 */
import { spawn } from 'node:child_process';
import { Gadget, z } from 'llmist';

const DEFAULT_TIMEOUT_MS = 300000; // 5 min for the gadget itself
const DEFAULT_WAIT_MS = 120000; // 120s to wait for initial output
const MAX_WAIT_MS = 120000; // Never wait longer than 120s - return with "running" status
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
	description: `Execute commands in tmux sessions.

**Use this for ALL commands** (npm, tests, builds, git, gh, etc.)

**COMMAND FORMAT:** Pass command as argv array, NOT a shell string.
- Correct: command=["gh", "pr", "create", "--body", "## Summary\\n\\nDetails here"]
- Correct: command=["npm", "test"]
- Wrong: command="npm test" (this is a string, not an array)
Commands are executed directly (no shell interpretation), so special characters in arguments are safe.

**ACTIONS:**
- \`start\`: Run a command in a new session. Waits up to 120s for initial output.
  - If command exits quickly: returns full output + exit status
  - If still running after 120s: returns partial output + "still running" message
  - **Process keeps running in background** - use capture to check progress
- \`capture\`: Get recent output from a running session
- \`send\`: Send keys/commands to a session (use "C-c" for Ctrl+C)
- \`list\`: List all active sessions
- \`kill\`: Terminate a session
- \`exists\`: Check if a session is running

**TYPICAL WORKFLOW:**
1. Start: Tmux(action="start", session="test-run", command=["npm", "test"])
2. If still running, check progress: Tmux(action="capture", session="test-run")
3. When done: Tmux(action="kill", session="test-run")

**SESSION NAMING:** Use descriptive names like "npm-install", "test-run", "lint-check", "build"`,
	timeoutMs: DEFAULT_TIMEOUT_MS,
	schema: z.discriminatedUnion('action', [
		// Start a new session with a command
		z.object({
			action: z.literal('start'),
			session: sessionNameSchema.describe("Unique session name (e.g., 'test-run', 'npm-install')"),
			command: z
				.array(z.string())
				.describe(
					"Command as argv array (e.g., ['npm', 'test'], ['gh', 'pr', 'create', '--body', 'markdown...'])",
				),
			cwd: z
				.string()
				.optional()
				.describe('Working directory for the command (default: current directory)'),
			wait: z.coerce
				.number()
				.default(DEFAULT_WAIT_MS)
				.describe('Max time to wait for initial output in ms (default: 120000, max: 120000)'),
		}),

		// Send keys/commands to an existing session
		z.object({
			action: z.literal('send'),
			session: sessionNameSchema.describe('Target session name'),
			keys: z.string().describe("Keys or command to send (e.g., 'npm test' or 'C-c' for Ctrl+C)"),
			enter: z.coerce
				.boolean()
				.default(true)
				.describe('Press Enter after sending keys (default: true)'),
		}),

		// Capture output from a session
		z.object({
			action: z.literal('capture'),
			session: sessionNameSchema.describe('Session to capture output from'),
			lines: z.coerce
				.number()
				.int()
				.min(1)
				.max(1000)
				.default(25)
				.describe('Number of lines to capture (default: 25, max: 1000)'),
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
			params: { action: 'start', session: 'test-run', command: ['npm', 'test'], wait: 120000 },
			output:
				'session=test-run status=exited exit_code=0\n\n> project@1.0.0 test\n> vitest run\n\n✓ 15 tests passed',
			comment: 'Run tests - command completed within 120s wait period',
		},
		{
			params: {
				action: 'start',
				session: 'e2e-tests',
				command: ['npm', 'run', 'test:e2e'],
				wait: 120000,
			},
			output:
				"session=e2e-tests status=running\n\nStarting backend...\n✓ Backend healthy\n\n(Process still running in session 'e2e-tests'. Use capture to check progress, kill when done.)",
			comment: 'Long-running E2E tests still running after 120s - use capture to monitor',
		},
		{
			params: { action: 'capture', session: 'npm-install', lines: 25 },
			output: 'session=npm-install lines=25\n\nadded 874 packages in 45s',
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
			case 'start':
				return this.handleStart(params);
			case 'send':
				return this.handleSend(params);
			case 'capture':
				return this.handleCapture(params);
			case 'list':
				return this.handleList();
			case 'kill':
				return this.handleKill(params);
			case 'exists':
				return this.handleExists(params);
			default:
				return 'status=error\n\nUnknown action';
		}
	}

	private async handleStart(params: {
		session: string;
		command: string[];
		cwd?: string;
		wait?: number;
	}): Promise<string> {
		// Check if session already exists
		const checkResult = await runTmux(['has-session', '-t', params.session]);
		if (checkResult.exitCode === 0) {
			return `session=${params.session} status=error\n\nSession '${params.session}' already exists. Use action="kill" first or choose a different name.`;
		}

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
			...(params.cwd ? ['-c', params.cwd] : []),
			// Pass command as argv array - no shell interpretation of special characters
			...params.command,
		]);

		if (result.exitCode !== 0) {
			return `session=${params.session} status=error\n\n${result.output || 'Failed to create session'}`;
		}

		// Set remain-on-exit as a pane option (-p flag) after session is created
		// This keeps the pane alive after command exits so we can capture its output
		await runTmux(['set-option', '-p', '-t', params.session, 'remain-on-exit', 'on']);

		return this.waitForOutput(params.session, params.wait);
	}

	private async waitForOutput(session: string, requestedWait?: number): Promise<string> {
		// Wait and poll for output - capture BEFORE checking if session ended
		// to avoid race condition where server shuts down
		// Cap wait time to MAX_WAIT_MS to ensure we return before gadget timeout
		const waitMs = Math.min(requestedWait ?? DEFAULT_WAIT_MS, MAX_WAIT_MS);
		let elapsed = 0;
		let sessionEnded = false;
		let lastOutput = '';
		let exitCode: number | null = null;

		while (elapsed < waitMs) {
			await sleep(POLL_INTERVAL_MS);
			elapsed += POLL_INTERVAL_MS;

			// Capture output first (while session/server is still guaranteed running)
			const capture = await runTmux(['capture-pane', '-t', session, '-p', '-S', '-200']);
			if (capture.exitCode === 0) {
				lastOutput = capture.output;
			}

			// Check if pane has died (remain-on-exit keeps pane but marks it dead)
			// Also get the exit status of the command that was running
			const check = await runTmux([
				'display-message',
				'-t',
				session,
				'-p',
				'#{pane_dead}\t#{pane_exit_status}',
			]);
			if (check.exitCode === 0) {
				const [dead, code] = check.output.trim().split('\t');
				if (dead === '1') {
					sessionEnded = true;
					exitCode = Number.parseInt(code, 10) || 0;
					break;
				}
			} else {
				// tmux command failed - session likely gone
				sessionEnded = true;
				break;
			}
		}

		const output = lastOutput.replace(/^\s*\n/, '').replace(/\n\s*$/, '');

		if (sessionEnded) {
			// Clean up the dead session
			await runTmux(['kill-session', '-t', session]);
			return `session=${session} status=exited exit_code=${exitCode ?? 'unknown'}\n\n${output || '(no output)'}`;
		}
		return `session=${session} status=running\n\n${output || '(no output yet)'}\n\n(Process still running in session '${session}'. Use capture to check progress, kill when done.)`;
	}

	private async handleSend(params: {
		session: string;
		keys: string;
		enter?: boolean;
	}): Promise<string> {
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

	private async handleCapture(params: { session: string; lines?: number }): Promise<string> {
		const lines = params.lines ?? 25;

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
			`-${lines}`, // start from N lines back
		]);

		if (result.exitCode !== 0) {
			return `session=${params.session} status=error\n\n${result.output || 'Failed to capture output'}`;
		}

		// Trim empty lines from start/end but preserve internal structure
		const captured = result.output.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
		return `session=${params.session} lines=${lines}\n\n${captured || '(no output yet)'}`;
	}

	private async handleList(): Promise<string> {
		const result = await runTmux([
			'list-sessions',
			'-F',
			'#{session_name}: #{pane_current_command} (#{?session_attached,attached,running})',
		]);

		if (result.exitCode !== 0) {
			// No sessions is not an error
			if (result.output.includes('no server running') || result.output.includes('no sessions')) {
				return 'sessions=0\n\nNo active tmux sessions';
			}
			return `status=error\n\n${result.output}`;
		}

		const sessions = result.output.split('\n').filter(Boolean);
		return `sessions=${sessions.length}\n\n${sessions.join('\n') || 'No active sessions'}`;
	}

	private async handleKill(params: { session: string }): Promise<string> {
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

	private async handleExists(params: { session: string }): Promise<string> {
		const result = await runTmux(['has-session', '-t', params.session]);
		const exists = result.exitCode === 0;
		return `session=${params.session} exists=${exists}\n\nSession '${params.session}' ${exists ? 'exists and is running' : 'does not exist'}`;
	}
}

// Export the class for use in agent builder
export { TmuxGadget as Tmux };
