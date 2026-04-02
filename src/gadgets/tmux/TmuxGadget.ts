/**
 * Tmux gadget - execute commands in tmux sessions.
 *
 * Uses tmux control mode for reliable output streaming and exit detection.
 * All commands run as windows within a single control session.
 */
import { Gadget, z } from 'llmist';
import {
	DEFAULT_TIMEOUT_MS,
	DEFAULT_WAIT_MS,
	EXIT_MARKER_PREFIX,
	EXIT_MARKER_SUFFIX,
	MAX_WAIT_MS,
	POLL_INTERVAL_MS,
	sessionNameSchema,
} from './constants.js';
import { CommandFailedError } from './errors.js';
import { validateGitCommand } from './gitValidation.js';
import { addPendingNotice } from './sessionNotices.js';
import { getControlClient, type TmuxControlClient } from './TmuxControlClient.js';
import { sanitizeSessionName, sleep } from './utils.js';

export class TmuxGadget extends Gadget({
	name: 'Tmux',
	description: `Execute commands in tmux sessions.

**Use this for ALL commands** (npm, tests, builds, git, etc.)

**COMMAND FORMAT:** Pass command as a shell string.
- command="npm test"
- command="npm run build && npm test"
- command="rg 'pattern' src/ | head -20"

Commands are interpreted by bash, so pipes, &&, ||, redirects, and globs all work.

**QUOTING:** When using git or commands with special characters:
- Use single quotes around values with parentheses: --title 'feat(scope): message'
- Example: command="git commit -m 'feat(auth): add login'"

**WORKING DIRECTORY:** Set \`cwd\` parameter to run commands in subdirectories.
- Tmux(action="start", session="test", command="npm test", cwd="packages/core")

**ACTIONS:**
- \`start\`: Run a command in a new session. Waits up to 120s for initial output.
  - If command exits with code 0: returns full output
  - **If command exits with non-zero code: THROWS AN ERROR** with output
  - If still running after 120s: returns partial output + "still running" message
  - **Process keeps running in background** - use capture to check progress
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
	maxConcurrent: 1, // Sequential execution to prevent race conditions
	schema: z.discriminatedUnion('action', [
		z.object({
			action: z.literal('start'),
			comment: z.string().min(1).describe('Brief rationale for this gadget call'),
			session: sessionNameSchema.describe("Unique session name (e.g., 'test-run', 'npm-install')"),
			command: z
				.string()
				.min(1)
				.describe("Shell command to execute (e.g., 'npm test', 'npm run build && npm test')"),
			cwd: z.string().optional().describe('Working directory for the command (default: repo root)'),
			wait: z.coerce
				.number()
				.default(DEFAULT_WAIT_MS)
				.describe('Max time to wait for initial output in ms (default: 120000, max: 120000)'),
		}),
		z.object({
			action: z.literal('send'),
			comment: z.string().min(1).describe('Brief rationale for this gadget call'),
			session: sessionNameSchema.describe('Target session name'),
			keys: z.string().describe("Keys or command to send (e.g., 'npm test' or 'C-c' for Ctrl+C)"),
			enter: z.coerce
				.boolean()
				.default(true)
				.describe('Press Enter after sending keys (default: true)'),
		}),
		z.object({
			action: z.literal('capture'),
			comment: z.string().min(1).describe('Brief rationale for this gadget call'),
			session: sessionNameSchema.describe('Session to capture output from'),
			lines: z.coerce
				.number()
				.int()
				.min(1)
				.max(1000)
				.default(25)
				.describe('Number of lines to capture (default: 25, max: 1000)'),
		}),
		z.object({
			action: z.literal('list'),
			comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		}),
		z.object({
			action: z.literal('kill'),
			comment: z.string().min(1).describe('Brief rationale for this gadget call'),
			session: sessionNameSchema.describe('Session to terminate'),
		}),
		z.object({
			action: z.literal('exists'),
			comment: z.string().min(1).describe('Brief rationale for this gadget call'),
			session: sessionNameSchema.describe('Session name to check'),
		}),
	]),
	examples: [
		{
			params: {
				action: 'start',
				comment: 'Running unit tests to verify changes',
				session: 'test-run',
				command: 'npm test',
				wait: 120000,
			},
			output:
				'session=test-run status=exited exit_code=0\n\n> project@1.0.0 test\n> vitest run\n\n✓ 15 tests passed',
			comment: 'Run tests - command completed within 120s wait period',
		},
		{
			params: {
				action: 'start',
				comment: 'Exploring vehicle service module dependencies',
				session: 'squint-modules',
				command: 'squint modules show backend.services.vehicles --json',
				wait: 15000,
			},
			output:
				'session=squint-modules status=exited exit_code=0\n\n{"path":"backend.services.vehicles","description":"Vehicle business logic","files":["src/services/vehicles.service.ts"],"dependencies":["backend.data.models","shared-types.entities.vehicles"],"dependents":["backend.api.vehicles"]}',
			comment:
				"Use squint to see a module's files, dependencies, and dependents before reading code",
		},
		{
			params: {
				action: 'start',
				comment: 'Tracing vehicle search data flow',
				session: 'squint-features',
				command: 'squint features show vehicle-inventory --json',
				wait: 15000,
			},
			output:
				'session=squint-features status=exited exit_code=0\n\n{"slug":"vehicle-inventory","description":"Vehicle CRUD and search","flows":["VehicleController.getAll -> VehicleService.getAll -> VehicleModel.findAll"],"modules":["backend.api.vehicles","backend.services.vehicles","backend.data.models"]}',
			comment: 'Use squint to trace how data flows through the system before exploring code',
		},
		{
			params: {
				action: 'start',
				comment: 'Running lint and tests in sequence',
				session: 'pipeline',
				command: 'npm run lint && npm test',
				wait: 120000,
			},
			output: 'session=pipeline status=exited exit_code=0\n\n✓ Lint passed\n✓ 15 tests passed',
			comment: 'Chain commands with &&',
		},
		{
			params: {
				action: 'start',
				comment: 'Testing frontend package separately',
				session: 'frontend-test',
				command: 'pnpm test',
				cwd: 'packages/frontend',
				wait: 120000,
			},
			output: 'session=frontend-test status=exited exit_code=0\n\n✓ 42 tests passed',
			comment: 'Run in subdirectory using cwd instead of cd prefix',
		},
		{
			params: {
				action: 'start',
				comment: 'Starting E2E test suite',
				session: 'e2e-tests',
				command: 'npm run test:e2e',
				wait: 120000,
			},
			output:
				"session=e2e-tests status=running\n\nStarting backend...\n✓ Backend healthy\n\n(Process still running in session 'e2e-tests'. Use capture to check progress, kill when done.)",
			comment: 'Long-running E2E tests still running after 120s - use capture to monitor',
		},
		{
			params: {
				action: 'capture',
				comment: 'Checking install progress',
				session: 'npm-install',
				lines: 25,
			},
			output: 'session=npm-install status=running lines=25\n\nadded 874 packages in 45s',
			comment: 'Check output from running session - status=running means command still executing',
		},
		{
			params: {
				action: 'capture',
				comment: 'Checking if tests completed',
				session: 'test-run',
				lines: 50,
			},
			output:
				'session=test-run status=exited exit_code=0 lines=50\n\n✓ 15 tests passed\n✓ All tests completed',
			comment: 'Capture shows command finished - status=exited with exit code',
		},
		{
			params: {
				action: 'send',
				comment: 'Stopping dev server',
				session: 'dev-server',
				keys: 'C-c',
				enter: false,
			},
			output: "session=dev-server status=sent\n\nSent keys to session 'dev-server': C-c",
			comment: 'Send Ctrl+C to stop a process',
		},
		{
			params: { action: 'kill', comment: 'Cleaning up completed session', session: 'npm-install' },
			output: "session=npm-install status=killed\n\nSession 'npm-install' terminated",
			comment: 'Terminate a session',
		},
		{
			params: { action: 'list', comment: 'Checking for running sessions' },
			output: 'sessions=2\n\ntest-run: npm (running)\nnpm-install: npm (running)',
			comment: 'List all active tmux sessions',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		// Sanitize session name if present (replaces / and other invalid chars with -)
		if ('session' in params && typeof params.session === 'string') {
			(params as { session: string }).session = sanitizeSessionName(params.session);
		}

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
		command: string;
		cwd?: string;
		wait?: number;
	}): Promise<string> {
		// Validate git commands don't bypass hooks
		validateGitCommand(params.command);

		const client = await getControlClient();

		// Check if window already exists
		if (await client.windowExists(params.session)) {
			return `session=${params.session} status=error\n\nSession '${params.session}' already exists. Use action="kill" first or choose a different name.`;
		}

		// Create window with command
		const paneId = await client.createWindow(params.session, params.command, params.cwd);
		if (!paneId.startsWith('%')) {
			return `session=${params.session} status=error\n\nFailed to create session: ${paneId}`;
		}

		// Wait for output/exit
		return this.waitForOutput(client, params.session, paneId, params.wait);
	}

	private cleanupOutput(output: string, removeDeadPane = false): string {
		let cleaned = output
			.replace(new RegExp(`${EXIT_MARKER_PREFIX}\\d+${EXIT_MARKER_SUFFIX}\\s*`), '')
			.replace(/\n{3,}/g, '\n\n')
			.trim();

		if (removeDeadPane) {
			cleaned = cleaned.replace(/\nPane is dead \([^)]+\)\s*$/, '');
		}

		return cleaned;
	}

	private async getSessionOutput(client: TmuxControlClient, session: string): Promise<string> {
		let output = client.getOutput(session);
		if (!output.trim()) {
			output = await client.capturePaneOutput(session);
		}
		return output;
	}

	private async handleCommandExit(
		client: TmuxControlClient,
		session: string,
		exitCode: number,
	): Promise<string> {
		const output = this.cleanupOutput(await this.getSessionOutput(client, session), true);
		const lines = output.split('\n');
		addPendingNotice(session, { exitCode, tailOutput: lines.slice(-100).join('\n') });
		await client.killWindow(session);

		if (exitCode !== 0) {
			throw new CommandFailedError(session, exitCode, output);
		}

		return `session=${session} status=exited exit_code=${exitCode}\n\n${output || '(no output)'}`;
	}

	private async waitForOutput(
		client: TmuxControlClient,
		session: string,
		paneId: string,
		requestedWait?: number,
	): Promise<string> {
		const waitMs = Math.min(requestedWait ?? DEFAULT_WAIT_MS, MAX_WAIT_MS);
		let elapsed = 0;

		while (elapsed < waitMs) {
			await sleep(POLL_INTERVAL_MS);
			elapsed += POLL_INTERVAL_MS;

			// Primary method: Check for exit marker in streamed output
			const markerResult = client.checkExitMarker(session);
			if (markerResult.exited) {
				return this.handleCommandExit(client, session, markerResult.exitCode);
			}

			// Fallback: Check if pane is dead via tmux
			const { dead, exitCode } = await client.isPaneDead(paneId);
			if (dead) {
				return this.handleCommandExit(client, session, exitCode);
			}
		}

		// Still running - get partial output
		const output = this.cleanupOutput(await this.getSessionOutput(client, session));
		return `session=${session} status=running\n\n${output || '(no output yet)'}\n\n(Process still running in session '${session}'. Use capture to check progress, kill when done.)`;
	}

	private async handleSend(params: {
		session: string;
		keys: string;
		enter?: boolean;
	}): Promise<string> {
		// Validate git commands don't bypass hooks (only when sending a command with Enter)
		if (params.enter !== false) {
			validateGitCommand(params.keys);
		}

		const client = await getControlClient();

		if (!(await client.windowExists(params.session))) {
			return `session=${params.session} status=error\n\nSession '${params.session}' does not exist`;
		}

		await client.sendKeys(params.session, params.keys, params.enter ?? true);

		const enterNote = params.enter ? ' [Enter]' : '';
		return `session=${params.session} status=sent\n\nSent keys to session '${params.session}': ${params.keys}${enterNote}`;
	}

	private async handleCapture(params: { session: string; lines?: number }): Promise<string> {
		const client = await getControlClient();
		const lines = params.lines ?? 25;

		// Check session status (existence + exit detection)
		const sessionStatus = await client.getSessionStatus(params.session);

		if (sessionStatus.status === 'not_found') {
			return `session=${params.session} status=error\n\nSession '${params.session}' does not exist`;
		}

		// Get output (try streamed output first, then capture-pane)
		let output = client.getOutput(params.session);
		if (!output.trim()) {
			output = await client.capturePaneOutput(params.session, lines);
		}

		// Take last N lines and clean up
		const outputLines = output.split('\n');
		let captured = outputLines.slice(-lines).join('\n').trim();

		// Clean exit marker from output if present
		captured = captured
			.replace(new RegExp(`${EXIT_MARKER_PREFIX}\\d+${EXIT_MARKER_SUFFIX}\\s*`), '')
			.replace(/\nPane is dead \([^)]+\)\s*$/, '')
			.trim();

		// Report status with exit code if exited
		if (sessionStatus.status === 'exited') {
			return `session=${params.session} status=exited exit_code=${sessionStatus.exitCode} lines=${lines}\n\n${captured || '(no output)'}`;
		}

		return `session=${params.session} status=running lines=${lines}\n\n${captured || '(no output yet)'}`;
	}

	private async handleList(): Promise<string> {
		const client = await getControlClient();

		try {
			const windows = await client.listWindows();
			// Filter out the initial shell window
			const filtered = windows.filter((w) => !w.startsWith('0:'));
			return `sessions=${filtered.length}\n\n${filtered.join('\n') || 'No active sessions'}`;
		} catch {
			return 'sessions=0\n\nNo active tmux sessions';
		}
	}

	private async handleKill(params: { session: string }): Promise<string> {
		const client = await getControlClient();

		if (!(await client.windowExists(params.session))) {
			return `session=${params.session} status=error\n\nSession '${params.session}' does not exist`;
		}

		await client.killWindow(params.session);
		return `session=${params.session} status=killed\n\nSession '${params.session}' terminated`;
	}

	private async handleExists(params: { session: string }): Promise<string> {
		const client = await getControlClient();
		const exists = await client.windowExists(params.session);
		return `session=${params.session} exists=${exists}\n\nSession '${params.session}' ${exists ? 'exists and is running' : 'does not exist'}`;
	}
}
