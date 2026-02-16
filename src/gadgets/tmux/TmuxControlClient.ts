import { type ChildProcess, execSync, spawn } from 'node:child_process';
import * as readline from 'node:readline';
import {
	CONTROL_SESSION,
	EXIT_MARKER_PREFIX,
	EXIT_MARKER_SUFFIX,
	MAX_OUTPUT_BUFFER,
} from './constants.js';
import { resolveWorkingDirectory, sleep, stripAnsi, unescapeOutput } from './utils.js';

/**
 * TmuxControlClient - manages a persistent control mode connection to tmux.
 * Uses event-driven protocol for real-time output and reliable exit detection.
 */
export class TmuxControlClient {
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

		// Resolve relative cwd against process.cwd() (repo root), since control session uses /tmp
		const effectiveCwd = resolveWorkingDirectory(cwd);
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

export async function getControlClient(): Promise<TmuxControlClient> {
	if (!controlClient) {
		controlClient = new TmuxControlClient();
	}
	if (!controlClient.isConnected()) {
		await controlClient.connect();
	}
	return controlClient;
}
