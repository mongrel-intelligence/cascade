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
 * Session name validation - alphanumeric, underscore, dash only.
 */
const sessionNameSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-zA-Z0-9_-]+$/, 'Session name must be alphanumeric with underscores or dashes only');

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

/**
 * TmuxControlClient - manages a persistent control mode connection to tmux.
 * Uses event-driven protocol for real-time output and reliable exit detection.
 */
class TmuxControlClient {
	private proc: ChildProcess | null = null;
	private rl: readline.Interface | null = null;
	private connected = false;

	// Command tracking - one at a time
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
	 * Connect to tmux in control mode.
	 * Creates a control session if needed, then attaches with -C flag.
	 */
	async connect(): Promise<void> {
		if (this.connected) return;

		// Kill any existing control session to start fresh
		try {
			execSync(`tmux kill-session -t ${CONTROL_SESSION} 2>/dev/null`);
		} catch {
			// Ignore - session may not exist
		}

		// Create the control session
		try {
			execSync(`tmux new-session -d -s ${CONTROL_SESSION} -x 200 -y 50`);
		} catch (err) {
			throw new Error(`Failed to create control session: ${err}`);
		}

		// Set remain-on-exit globally so we can query exit status
		try {
			execSync('tmux set-option -g remain-on-exit on');
		} catch {
			// Ignore - best effort
		}

		// Attach in control mode
		this.proc = spawn('tmux', ['-C', 'attach-session', '-t', CONTROL_SESSION], {
			stdio: ['pipe', 'pipe', 'pipe'],
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
		this.connected = true;
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
			// Parse: %output %paneId escaped_content
			const match = line.match(/^%output (%\d+) (.*)$/);
			if (match) {
				const [, paneId, escaped] = match;
				const unescaped = unescapeOutput(escaped);
				if (!this.paneOutputs.has(paneId)) {
					this.paneOutputs.set(paneId, []);
				}
				const buffer = this.paneOutputs.get(paneId);
				if (buffer) {
					buffer.push(unescaped);
					// Truncate if too large
					const totalSize = buffer.reduce((sum, s) => sum + s.length, 0);
					if (totalSize > MAX_OUTPUT_BUFFER) {
						buffer.shift(); // Remove oldest
					}
				}
			}
		} else if (line.startsWith('%message ')) {
			// display-message output
			this.lastMessage = line.slice(9); // Remove "%message "
		} else if (
			line.startsWith('%session') ||
			line.startsWith('%window') ||
			line.startsWith('%pane') ||
			line.startsWith('%client') ||
			line.startsWith('%exit') ||
			line.startsWith('%unlinked') ||
			line.startsWith('%subscription') ||
			line.startsWith('%layout') ||
			line.startsWith('%paste')
		) {
			// Ignore tmux notification events - these must NOT be added to currentBlock
			// Note: Pane IDs like "%0" or "%1" are valid command output and must pass through
			return;
		} else if (this.currentBlock) {
			// Add line to command response block (includes pane IDs like "%0", "%1")
			this.currentBlock.lines.push(line);
		}
	}

	/**
	 * Send a command to tmux and wait for response
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

		return new Promise((resolve, reject) => {
			if (this.pendingCommand) {
				reject(new Error('Already have a pending command'));
				return;
			}

			if (!this.proc?.stdin) {
				reject(new Error('Not connected to tmux'));
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
	async createWindow(windowName: string, command: string[], cwd?: string): Promise<string> {
		// Use base64 encoding to pass arguments verbatim through tmux
		// Each arg is encoded, then decoded at runtime via command substitution
		// This preserves newlines, backticks, $, quotes - everything passes through unchanged
		const args = command
			.map((arg) => {
				const base64 = Buffer.from(arg).toString('base64');
				return `"$(echo '${base64}' | base64 -d)"`;
			})
			.join(' ');

		const shellCmd = `bash -c '${args}; echo "${EXIT_MARKER_PREFIX}$?${EXIT_MARKER_SUFFIX}"'`;

		const cwdArg = cwd ? `-c "${cwd.replace(/"/g, '\\"')}" ` : '';
		const result = await this.sendCommand(
			`new-window -t ${CONTROL_SESSION} -n ${windowName} ${cwdArg}-PF "#{pane_id}" ${shellCmd}`,
		);

		const paneId = result.trim();
		if (paneId.startsWith('%')) {
			this.windowToPaneId.set(windowName, paneId);
			this.paneOutputs.set(paneId, []);
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

**COMMAND FORMAT:** Pass command as argv array, NOT a shell string.
- ✅ Correct: command=["npm", "test"]
- ✅ Correct: command=["rg", "UserRow", "src/"]
- ✅ Correct: command=["rg", "-F", "import { users }", "src/"]
- ✅ Correct: command=["gh", "pr", "create", "--body", "## Summary\\n\\nDetails here"]
- ❌ Wrong: command="npm test" (string, not array!)
- ❌ Wrong: command=["rg", "\\"UserRow\\"", "src/"] (don't add quotes!)

Commands are executed directly (no shell interpretation), so special characters in arguments are safe.
**CRITICAL:** Do NOT add quote characters around search patterns or other arguments - each array element is already a separate argument!

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
		z.object({
			action: z.literal('send'),
			session: sessionNameSchema.describe('Target session name'),
			keys: z.string().describe("Keys or command to send (e.g., 'npm test' or 'C-c' for Ctrl+C)"),
			enter: z.coerce
				.boolean()
				.default(true)
				.describe('Press Enter after sending keys (default: true)'),
		}),
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
		z.object({
			action: z.literal('list'),
		}),
		z.object({
			action: z.literal('kill'),
			session: sessionNameSchema.describe('Session to terminate'),
		}),
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
			// This is the most reliable as it doesn't depend on tmux's pane_dead
			const markerResult = client.checkExitMarker(session);
			if (markerResult.exited) {
				let output = client.getOutput(session);
				if (!output.trim()) {
					output = await client.capturePaneOutput(session);
				}

				// Clean up output - remove exit marker and formatting
				output = output
					.replace(new RegExp(`${EXIT_MARKER_PREFIX}\\d+${EXIT_MARKER_SUFFIX}\\s*`), '')
					.replace(/\nPane is dead \([^)]+\)\s*$/, '')
					.replace(/\n{3,}/g, '\n\n')
					.trim();

				// Kill the window
				await client.killWindow(session);

				return `session=${session} status=exited exit_code=${markerResult.exitCode}\n\n${output || '(no output)'}`;
			}

			// Fallback: Check if pane is dead via tmux
			const { dead, exitCode } = await client.isPaneDead(paneId);
			if (dead) {
				let output = client.getOutput(session);
				if (!output.trim()) {
					output = await client.capturePaneOutput(session);
				}

				// Clean up output
				output = output
					.replace(new RegExp(`${EXIT_MARKER_PREFIX}\\d+${EXIT_MARKER_SUFFIX}\\s*`), '')
					.replace(/\nPane is dead \([^)]+\)\s*$/, '')
					.replace(/\n{3,}/g, '\n\n')
					.trim();

				await client.killWindow(session);

				return `session=${session} status=exited exit_code=${exitCode}\n\n${output || '(no output)'}`;
			}
		}

		// Still running - get partial output
		let output = client.getOutput(session);
		if (!output.trim()) {
			output = await client.capturePaneOutput(session);
		}

		output = output
			.replace(new RegExp(`${EXIT_MARKER_PREFIX}\\d+${EXIT_MARKER_SUFFIX}\\s*`), '')
			.replace(/\n{3,}/g, '\n\n')
			.trim();

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

		if (!(await client.windowExists(params.session))) {
			return `session=${params.session} status=error\n\nSession '${params.session}' does not exist`;
		}

		// Try streamed output first, then capture-pane
		let output = client.getOutput(params.session);
		if (!output.trim()) {
			output = await client.capturePaneOutput(params.session, lines);
		}

		// Take last N lines
		const outputLines = output.split('\n');
		const captured = outputLines.slice(-lines).join('\n').trim();

		return `session=${params.session} lines=${lines}\n\n${captured || '(no output yet)'}`;
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
