/**
 * Tmux gadget - execute commands in tmux sessions.
 *
 * Uses tmux control mode for reliable output streaming and exit detection.
 * All commands run as windows within a single control session.
 */
import { type ChildProcess, execSync, spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { Gadget, z } from 'llmist';

const DEFAULT_TIMEOUT_MS = 300000; // 5 min for the gadget itself
const DEFAULT_WAIT_MS = 120000; // 120s to wait for initial output
const MAX_WAIT_MS = 120000; // Never wait longer than 120s
const POLL_INTERVAL_MS = 100; // Faster polling since we have streamed output
const MAX_OUTPUT_BUFFER = 10 * 1024 * 1024; // 10MB max output per pane

const CONTROL_SESSION = '_cascade_control';
const EXIT_MARKER_PREFIX = '___CASCADE_EXIT_';
const EXIT_MARKER_SUFFIX = '___';

/**
 * Session name schema - accepts any string, sanitized at runtime.
 * Invalid characters (like /) are automatically replaced with dashes.
 */
const sessionNameSchema = z.string().min(1).max(64);

/**
 * Sanitize session name by replacing invalid characters with dashes.
 */
function sanitizeSessionName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * Unescape tmux control mode output (octal escapes like \012 -> \n)
 */
function unescapeOutput(s: string): string {
	return s.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(Number.parseInt(oct, 8)));
}

// ANSI escape code patterns (using hex to avoid lint errors about control chars)
const ESC = '\u001b';
const BEL = '\u0007';
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, 'g');
const OSC_PATTERN = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, 'g');
const DCS_PATTERN = new RegExp(`${ESC}[PX^_][^${ESC}]*${ESC}\\\\`, 'g');

/**
 * Strip ANSI escape codes from output
 */
function stripAnsi(s: string): string {
	return s
		.replace(ANSI_PATTERN, '')
		.replace(OSC_PATTERN, '')
		.replace(DCS_PATTERN, '')
		.replace(/\r/g, '');
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Session Completion Notices
// ============================================================================

/**
 * Completed session notice - stored for injection into agent conversation.
 */
interface CompletedSessionNotice {
	exitCode: number;
	tailOutput: string; // Last 100 lines
}

/**
 * Pending notices for sessions that completed.
 * Consumed by agent loop to inject as user messages.
 */
const pendingNotices = new Map<string, CompletedSessionNotice>();

/**
 * Get and clear pending session completion notices.
 * Called by agent loop to inject into conversation via injectUserMessage().
 */
export function consumePendingSessionNotices(): Map<string, CompletedSessionNotice> {
	const notices = new Map(pendingNotices);
	pendingNotices.clear();
	return notices;
}

/**
 * TmuxControlClient - manages a persistent control mode connection to tmux.
 * Uses event-driven protocol for real-time output and reliable exit detection.
 */
class TmuxControlClient {
	private proc: ChildProcess | null = null;
	private rl: readline.Interface | null = null;
	private connected = false;

	// Connection lock - prevents race conditions when multiple parallel calls try to connect
	private connectPromise: Promise<void> | null = null;

	// Command queue - allows parallel gadget calls to queue and wait
	private commandQueue: Array<{
		cmd: string;
		resolve: (v: string) => void;
		reject: (e: Error) => void;
	}> = [];
	private processingQueue = false;

	// Current command being processed
	private pendingCommand: { resolve: (v: string) => void; reject: (e: Error) => void } | null =
		null;
	private currentBlock: { lines: string[] } | null = null;

	// Pane output buffers (keyed by pane ID like "%1")
	private paneOutputs = new Map<string, string[]>();

	// Window name to pane ID mapping
	private windowToPaneId = new Map<string, string>();

	// Message output (from display-message)
	private lastMessage = '';

	/**
	 * Connect to tmux in control mode with retry support.
	 * Creates a control session if needed, then attaches with -C flag.
	 * Uses a connection lock to prevent race conditions from parallel calls.
	 */
	async connect(): Promise<void> {
		// Already connected and process is running
		if (this.connected && this.proc && this.proc.exitCode === null) return;

		// If another connection attempt is in progress, wait for it
		if (this.connectPromise) {
			await this.connectPromise;
			// After waiting, check if we're now connected
			if (this.connected && this.proc && this.proc.exitCode === null) return;
		}

		// Start a new connection attempt with retry logic
		this.connectPromise = this.connectWithRetry();

		try {
			await this.connectPromise;
		} finally {
			this.connectPromise = null;
		}
	}

	/**
	 * Internal connection logic with retry support.
	 */
	private async connectWithRetry(): Promise<void> {
		let lastError: Error | null = null;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				await this.connectOnce();
				return;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				if (attempt < 1) {
					await sleep(500); // Wait before retry
				}
			}
		}
		throw lastError ?? new Error('Failed to connect to tmux after retries');
	}

	/**
	 * Single connection attempt to tmux control mode.
	 */
	private async connectOnce(): Promise<void> {
		// Reset state
		this.connected = false;
		this.proc = null;
		this.rl = null;

		// Kill any existing control session to start fresh
		try {
			execSync(`tmux kill-session -t ${CONTROL_SESSION} 2>/dev/null`);
		} catch {
			// Ignore - session may not exist
		}

		// Create the control session with explicit CWD to avoid stale directory issues
		// When CASCADE chdirs to temp directories that are later deleted, the tmux
		// session would inherit an invalid CWD causing "getcwd: cannot access parent directories" errors
		try {
			execSync(`tmux new-session -d -s ${CONTROL_SESSION} -x 200 -y 50 -c /tmp`);
		} catch (err) {
			throw new Error(`Failed to create control session: ${err}`);
		}

		// Attach in control mode with explicit CWD
		this.proc = spawn('tmux', ['-C', 'attach-session', '-t', CONTROL_SESSION], {
			stdio: ['pipe', 'pipe', 'pipe'],
			cwd: '/tmp',
		});

		if (!this.proc.stdout) {
			throw new Error('Failed to get stdout from tmux process');
		}
		this.rl = readline.createInterface({ input: this.proc.stdout });

		// Set up line parsing
		this.rl.on('line', (line) => this.parseLine(line));

		this.proc.on('close', () => {
			this.connected = false;
			this.proc = null;
			this.rl = null;
		});

		this.proc.on('error', (err) => {
			console.error('Tmux control mode error:', err);
			this.connected = false;
		});

		// Wait for initial connection
		await sleep(300);

		// Verify the process is still running and stdin is available
		if (!this.proc || this.proc.exitCode !== null || !this.proc.stdin) {
			this.connected = false;
			throw new Error(
				'Failed to connect to tmux: process exited immediately. Check if tmux is installed and working.',
			);
		}

		this.connected = true;
	}

	private static readonly IGNORED_NOTIFICATION_PREFIXES = [
		'%session',
		'%window',
		'%pane',
		'%client',
		'%exit',
		'%unlinked',
		'%subscription',
		'%layout',
		'%paste',
	];

	private isIgnoredNotification(line: string): boolean {
		return TmuxControlClient.IGNORED_NOTIFICATION_PREFIXES.some((prefix) =>
			line.startsWith(prefix),
		);
	}

	private handleOutputLine(line: string): void {
		const match = line.match(/^%output (%\d+) (.*)$/);
		if (!match) return;

		const [, paneId, escaped] = match;
		const unescaped = unescapeOutput(escaped);

		if (!this.paneOutputs.has(paneId)) {
			this.paneOutputs.set(paneId, []);
		}

		const buffer = this.paneOutputs.get(paneId);
		if (buffer) {
			buffer.push(unescaped);
			const totalSize = buffer.reduce((sum, s) => sum + s.length, 0);
			if (totalSize > MAX_OUTPUT_BUFFER) {
				buffer.shift();
			}
		}
	}

	/**
	 * Parse a line from tmux control mode protocol
	 */
	private parseLine(line: string): void {
		if (line.startsWith('%begin ')) {
			this.currentBlock = { lines: [] };
		} else if (line.startsWith('%end ') || line.startsWith('%error ')) {
			if (this.currentBlock && this.pendingCommand) {
				this.pendingCommand.resolve(this.currentBlock.lines.join('\n'));
				this.pendingCommand = null;
			}
			this.currentBlock = null;
		} else if (line.startsWith('%output ')) {
			this.handleOutputLine(line);
		} else if (line.startsWith('%message ')) {
			this.lastMessage = line.slice(9);
		} else if (this.isIgnoredNotification(line)) {
			return;
		} else if (this.currentBlock) {
			this.currentBlock.lines.push(line);
		}
	}

	/**
	 * Send a command to tmux and wait for response.
	 * Commands are queued and executed sequentially to handle parallel gadget calls.
	 */
	async sendCommand(cmd: string): Promise<string> {
		// Reconnect if needed
		if (!this.connected || !this.proc || this.proc.exitCode !== null) {
			this.connected = false;
			this.proc = null;
			this.windowToPaneId.clear();
			this.paneOutputs.clear();
			await this.connect();
		}

		// Queue the command and process
		return new Promise((resolve, reject) => {
			this.commandQueue.push({ cmd, resolve, reject });
			this.processQueue();
		});
	}

	/**
	 * Process queued commands sequentially.
	 * Only one command can be processed at a time due to tmux control mode protocol.
	 */
	private processQueue(): void {
		if (this.processingQueue || this.commandQueue.length === 0) return;
		this.processingQueue = true;

		const processNext = () => {
			if (this.commandQueue.length === 0) {
				this.processingQueue = false;
				return;
			}

			const item = this.commandQueue.shift();
			if (!item) return;
			const { cmd, resolve, reject } = item;
			this.executeCommandInternal(cmd)
				.then(resolve)
				.catch(reject)
				.finally(() => {
					// Process next command after a small delay to let tmux settle
					setTimeout(processNext, 10);
				});
		};

		processNext();
	}

	/**
	 * Internal command execution - actually sends to tmux and waits for response
	 */
	private executeCommandInternal(cmd: string): Promise<string> {
		return new Promise((resolve, reject) => {
			if (this.pendingCommand) {
				// This shouldn't happen with queue, but just in case
				reject(new Error('Already have a pending command'));
				return;
			}

			if (!this.proc?.stdin) {
				reject(
					new Error(
						'Not connected to tmux - process stdin unavailable. Check if tmux is installed and working.',
					),
				);
				return;
			}

			this.lastMessage = '';

			// Set up timeout - MUST be cleared when command completes
			const timeoutId = setTimeout(() => {
				if (this.pendingCommand) {
					this.pendingCommand = null;
					reject(new Error('Command timed out'));
				}
			}, 30000);

			// Wrap resolve/reject to clear timeout
			this.pendingCommand = {
				resolve: (result: string) => {
					clearTimeout(timeoutId);
					resolve(result);
				},
				reject: (err: Error) => {
					clearTimeout(timeoutId);
					reject(err);
				},
			};

			this.proc.stdin.write(`${cmd}\n`);
		});
	}

	/**
	 * Get the last message from display-message
	 */
	getLastMessage(): string {
		return this.lastMessage;
	}

	/**
	 * Create a new window with a command.
	 * Wraps command in a shell that emits an exit marker for reliable exit detection.
	 */
	async createWindow(windowName: string, command: string, cwd?: string): Promise<string> {
		// Base64 encode the entire command to pass through tmux safely
		// Use single quotes for bash -c and eval to properly handle quotes in decoded command
		const base64 = Buffer.from(command).toString('base64');
		const shellCmd = `bash -c 'eval "$(echo ${base64} | base64 -d)"; echo "${EXIT_MARKER_PREFIX}$?${EXIT_MARKER_SUFFIX}"'`;

		// Default to process.cwd() when cwd not provided, since control session uses /tmp
		const effectiveCwd = cwd ?? process.cwd();
		const cwdArg = `-c "${effectiveCwd.replace(/"/g, '\\"')}" `;
		const result = await this.sendCommand(
			`new-window -t ${CONTROL_SESSION} -n ${windowName} ${cwdArg}-PF "#{pane_id}" ${shellCmd}`,
		);

		const paneId = result.trim();
		if (paneId.startsWith('%')) {
			this.windowToPaneId.set(windowName, paneId);
			this.paneOutputs.set(paneId, []);

			// Set remain-on-exit for this pane so output can be captured after command exits
			await this.sendCommand(`set-option -p -t ${paneId} remain-on-exit on`);
		}

		return paneId;
	}

	/**
	 * Check if command has exited by looking for exit marker in output.
	 * This is the most reliable method as it doesn't depend on tmux's pane_dead.
	 */
	checkExitMarker(windowName: string): { exited: boolean; exitCode: number } {
		const paneId = this.windowToPaneId.get(windowName);
		if (!paneId) return { exited: false, exitCode: 0 };

		const buffer = this.paneOutputs.get(paneId);
		if (!buffer) return { exited: false, exitCode: 0 };

		// Search for exit marker in output
		const output = buffer.join('');
		const markerMatch = output.match(
			new RegExp(`${EXIT_MARKER_PREFIX}(\\d+)${EXIT_MARKER_SUFFIX}`),
		);
		if (markerMatch) {
			return { exited: true, exitCode: Number.parseInt(markerMatch[1], 10) };
		}

		return { exited: false, exitCode: 0 };
	}

	/**
	 * Check if a pane is dead (command exited)
	 * First checks exit marker (most reliable), then capture-pane, then pane_dead variable.
	 */
	async isPaneDead(paneId: string): Promise<{ dead: boolean; exitCode: number }> {
		// Method 1: Check for "Pane is dead" text in capture-pane
		// This appears when remain-on-exit is on
		const captured = await this.sendCommand(`capture-pane -t ${paneId} -p -S -10`);
		const deadMatch = captured.match(/Pane is dead \(status (\d+)\)/);
		if (deadMatch) {
			return { dead: true, exitCode: Number.parseInt(deadMatch[1], 10) };
		}

		// Method 2: Check pane_dead variable
		const result = await this.sendCommand(
			`list-panes -t ${paneId} -F "#{pane_dead}\t#{pane_dead_status}"`,
		);
		const [dead, status] = result.trim().split('\t');

		return {
			dead: dead === '1',
			exitCode: status ? Number.parseInt(status, 10) : 0,
		};
	}

	/**
	 * Get session status - checks if command has exited and returns exit code.
	 * Combines checkExitMarker and isPaneDead for comprehensive detection.
	 */
	async getSessionStatus(
		windowName: string,
	): Promise<{ status: 'running' | 'exited' | 'not_found'; exitCode?: number }> {
		// Check if window exists first
		if (!(await this.windowExists(windowName))) {
			return { status: 'not_found' };
		}

		// Method 1: Check for exit marker in streamed output (most reliable)
		const markerResult = this.checkExitMarker(windowName);
		if (markerResult.exited) {
			return { status: 'exited', exitCode: markerResult.exitCode };
		}

		// Method 2: Check if pane is dead via tmux
		const paneId = this.windowToPaneId.get(windowName);
		if (paneId) {
			const { dead, exitCode } = await this.isPaneDead(paneId);
			if (dead) {
				return { status: 'exited', exitCode };
			}
		}

		return { status: 'running' };
	}

	/**
	 * Get buffered output for a window
	 */
	getOutput(windowName: string): string {
		const paneId = this.windowToPaneId.get(windowName);
		if (!paneId) return '';

		const buffer = this.paneOutputs.get(paneId);
		if (!buffer) return '';

		// Join and strip ANSI escape codes
		return stripAnsi(buffer.join(''));
	}

	/**
	 * Capture pane output via tmux command (backup method)
	 */
	async capturePaneOutput(windowName: string, lines = 200): Promise<string> {
		const paneId = this.windowToPaneId.get(windowName);
		const target = paneId || `${CONTROL_SESSION}:${windowName}`;

		const result = await this.sendCommand(`capture-pane -t ${target} -p -S -${lines}`);
		return result;
	}

	/**
	 * Kill a window
	 */
	async killWindow(windowName: string): Promise<void> {
		const paneId = this.windowToPaneId.get(windowName);
		if (paneId) {
			this.paneOutputs.delete(paneId);
			this.windowToPaneId.delete(windowName);
		}
		await this.sendCommand(`kill-window -t ${CONTROL_SESSION}:${windowName}`);
	}

	/**
	 * Check if a window exists
	 */
	async windowExists(windowName: string): Promise<boolean> {
		// Check in-memory map first
		if (this.windowToPaneId.has(windowName)) {
			return true;
		}
		// Query tmux for window list
		try {
			const result = await this.sendCommand(
				`list-windows -t ${CONTROL_SESSION} -F "#{window_name}"`,
			);
			const windows = result.split('\n').map((w) => w.trim());
			return windows.includes(windowName);
		} catch {
			return false;
		}
	}

	/**
	 * Send keys to a window
	 */
	async sendKeys(windowName: string, keys: string, enter: boolean): Promise<void> {
		const enterArg = enter ? ' Enter' : '';
		await this.sendCommand(
			`send-keys -t ${CONTROL_SESSION}:${windowName} "${keys.replace(/"/g, '\\"')}"${enterArg}`,
		);
	}

	/**
	 * List all windows
	 */
	async listWindows(): Promise<string[]> {
		const result = await this.sendCommand(
			`list-windows -t ${CONTROL_SESSION} -F "#{window_name}: #{pane_current_command} (#{?pane_dead,exited,running})"`,
		);
		return result.split('\n').filter((line) => line.trim() && !line.includes('(exited)'));
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Disconnect from control mode
	 */
	disconnect(): void {
		if (this.proc) {
			this.proc.stdin?.write('\n'); // Empty line to detach
			this.proc.kill();
			this.proc = null;
		}
		this.connected = false;
	}
}

// Singleton control client
let controlClient: TmuxControlClient | null = null;

async function getControlClient(): Promise<TmuxControlClient> {
	if (!controlClient) {
		controlClient = new TmuxControlClient();
	}
	if (!controlClient.isConnected()) {
		await controlClient.connect();
	}
	return controlClient;
}

class TmuxGadget extends Gadget({
	name: 'Tmux',
	description: `Execute commands in tmux sessions.

**Use this for ALL commands** (npm, tests, builds, git, gh, etc.)

**COMMAND FORMAT:** Pass command as a shell string.
- command="npm test"
- command="npm run build && npm test"
- command="rg 'pattern' src/ | head -20"

Commands are interpreted by bash, so pipes, &&, ||, redirects, and globs all work.

**QUOTING:** When using gh, git, or commands with special characters:
- Use single quotes around values with parentheses: --title 'feat(scope): message'
- Example: command="gh pr create --title 'feat(auth): add login' --body 'Description'"

**WORKING DIRECTORY:** Set \`cwd\` parameter to run commands in subdirectories.
- Tmux(action="start", session="test", command="npm test", cwd="packages/core")

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
		{
			params: {
				action: 'start',
				comment: 'Creating PR for OAuth feature',
				session: 'create-pr',
				command:
					"gh pr create --title 'feat(auth): add OAuth login' --body 'Implements OAuth flow'",
				wait: 30000,
			},
			output:
				'session=create-pr status=exited exit_code=0\n\nCreating pull request for feature/oauth...\nhttps://github.com/org/repo/pull/123',
			comment:
				'Create PR - note single quotes around title with parentheses to prevent shell errors',
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
				const output = this.cleanupOutput(await this.getSessionOutput(client, session), true);

				// Store notice for injection into agent conversation
				const lines = output.split('\n');
				const tailOutput = lines.slice(-100).join('\n');
				pendingNotices.set(session, {
					exitCode: markerResult.exitCode,
					tailOutput,
				});

				await client.killWindow(session);
				return `session=${session} status=exited exit_code=${markerResult.exitCode}\n\n${output || '(no output)'}`;
			}

			// Fallback: Check if pane is dead via tmux
			const { dead, exitCode } = await client.isPaneDead(paneId);
			if (dead) {
				const output = this.cleanupOutput(await this.getSessionOutput(client, session), true);

				// Store notice for injection into agent conversation
				const lines = output.split('\n');
				const tailOutput = lines.slice(-100).join('\n');
				pendingNotices.set(session, {
					exitCode,
					tailOutput,
				});

				await client.killWindow(session);
				return `session=${session} status=exited exit_code=${exitCode}\n\n${output || '(no output)'}`;
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

export { TmuxGadget as Tmux };
