import { EventEmitter } from 'node:events';
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_MARKER_PREFIX, EXIT_MARKER_SUFFIX } from '../../../../src/gadgets/tmux/constants.js';

// ─── Mock readline ─────────────────────────────────────────────────────────────
// readline.createInterface needs a real readable stream — mock it instead
const mockRl = {
	on: vi.fn(),
	close: vi.fn(),
};
vi.mock('node:readline', () => ({
	createInterface: vi.fn(() => mockRl),
}));

// ─── Mock child_process ────────────────────────────────────────────────────────
vi.mock('node:child_process', () => ({
	execSync: vi.fn(),
	spawn: vi.fn(),
}));

// ─── Mock the filterProcessEnv from claude-code env ──────────────────────────
vi.mock('../../../../src/backends/claude-code/env.js', () => ({
	filterProcessEnv: vi.fn((env: NodeJS.ProcessEnv) => env),
}));

import { execSync, spawn } from 'node:child_process';
import { TmuxControlClient } from '../../../../src/gadgets/tmux/TmuxControlClient.js';

/**
 * Create a mock child process with stdin/stdout as event emitters.
 */
function createMockProcess() {
	const stdout = new EventEmitter();
	const stdin = {
		write: vi.fn(),
	};

	const proc = new EventEmitter() as unknown as {
		stdin: typeof stdin;
		stdout: typeof stdout;
		exitCode: number | null;
		kill: () => void;
		on: (event: string, handler: (...args: unknown[]) => void) => void;
	};
	Object.assign(proc, {
		stdin,
		stdout,
		exitCode: null,
		kill: vi.fn(),
	});

	return { proc, stdout, stdin };
}

describe('TmuxControlClient', () => {
	let client: TmuxControlClient;
	let mockExecSync: MockInstance;
	let mockSpawn: MockInstance;

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset readline mock
		mockRl.on.mockImplementation(() => mockRl);
		mockExecSync = vi.mocked(execSync);
		mockSpawn = vi.mocked(spawn);
		client = new TmuxControlClient();
	});

	afterEach(() => {
		client.disconnect();
	});

	// ─── connect() ────────────────────────────────────────────────────────────
	describe('connect()', () => {
		it('spawns tmux in control mode after creating session', async () => {
			const { proc } = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			await client.connect();

			expect(mockExecSync).toHaveBeenCalledWith(
				expect.stringContaining('new-session'),
				expect.any(Object),
			);
			expect(mockSpawn).toHaveBeenCalledWith(
				'tmux',
				['-C', 'attach-session', '-t', expect.stringContaining('_cascade_control')],
				expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
			);
		});

		it('is idempotent — calling connect() twice does not spawn twice', async () => {
			const { proc } = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			await client.connect();
			await client.connect(); // Second call — already connected

			// spawn should only be called once
			expect(mockSpawn).toHaveBeenCalledTimes(1);
		});

		it('throws when tmux process exits immediately', async () => {
			const { proc } = createMockProcess();
			// Simulate immediate exit
			proc.exitCode = 1;
			mockSpawn.mockReturnValue(proc);

			await expect(client.connect()).rejects.toThrow(/Failed to connect to tmux/);
		});

		it('kills existing session before creating new one', async () => {
			const { proc } = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			await client.connect();

			// First execSync call should be the kill-session call
			expect(mockExecSync).toHaveBeenCalledWith(
				expect.stringContaining('kill-session'),
				expect.any(Object),
			);
		});
	});

	// ─── checkExitMarker() ────────────────────────────────────────────────────
	describe('checkExitMarker()', () => {
		it('returns exited=false when window has no mapping', () => {
			const result = client.checkExitMarker('nonexistent-window');
			expect(result).toEqual({ exited: false, exitCode: 0 });
		});

		it('detects exit marker with code 0 in output buffer', () => {
			const privateClient = client as unknown as {
				windowToPaneId: Map<string, string>;
				paneOutputs: Map<string, string[]>;
			};
			privateClient.windowToPaneId.set('test-window', '%1');
			privateClient.paneOutputs.set('%1', [
				'some output\n',
				`${EXIT_MARKER_PREFIX}0${EXIT_MARKER_SUFFIX}\n`,
			]);

			const result = client.checkExitMarker('test-window');
			expect(result).toEqual({ exited: true, exitCode: 0 });
		});

		it('extracts non-zero exit code from marker', () => {
			const privateClient = client as unknown as {
				windowToPaneId: Map<string, string>;
				paneOutputs: Map<string, string[]>;
			};
			privateClient.windowToPaneId.set('fail-window', '%2');
			privateClient.paneOutputs.set('%2', [`${EXIT_MARKER_PREFIX}127${EXIT_MARKER_SUFFIX}`]);

			const result = client.checkExitMarker('fail-window');
			expect(result).toEqual({ exited: true, exitCode: 127 });
		});

		it('returns exited=false when no exit marker in output', () => {
			const privateClient = client as unknown as {
				windowToPaneId: Map<string, string>;
				paneOutputs: Map<string, string[]>;
			};
			privateClient.windowToPaneId.set('running-window', '%3');
			privateClient.paneOutputs.set('%3', ['line 1\n', 'line 2\n', 'still running\n']);

			const result = client.checkExitMarker('running-window');
			expect(result).toEqual({ exited: false, exitCode: 0 });
		});

		it('returns exited=false when pane has no output buffer', () => {
			const privateClient = client as unknown as {
				windowToPaneId: Map<string, string>;
			};
			privateClient.windowToPaneId.set('empty-window', '%4');
			// No paneOutputs entry

			const result = client.checkExitMarker('empty-window');
			expect(result).toEqual({ exited: false, exitCode: 0 });
		});
	});

	// ─── getOutput() ──────────────────────────────────────────────────────────
	describe('getOutput()', () => {
		it('returns empty string for unknown window', () => {
			expect(client.getOutput('nonexistent')).toBe('');
		});

		it('returns joined and ANSI-stripped buffer contents', () => {
			const privateClient = client as unknown as {
				windowToPaneId: Map<string, string>;
				paneOutputs: Map<string, string[]>;
			};
			privateClient.windowToPaneId.set('my-window', '%1');
			privateClient.paneOutputs.set('%1', ['hello ', 'world\n']);

			const output = client.getOutput('my-window');
			expect(output).toBe('hello world\n');
		});

		it('returns empty string when pane buffer is missing', () => {
			const privateClient = client as unknown as {
				windowToPaneId: Map<string, string>;
			};
			privateClient.windowToPaneId.set('no-buffer', '%9');
			// No paneOutputs entry

			expect(client.getOutput('no-buffer')).toBe('');
		});
	});

	// ─── isConnected() / disconnect() ─────────────────────────────────────────
	describe('isConnected() and disconnect()', () => {
		it('returns false before connecting', () => {
			expect(client.isConnected()).toBe(false);
		});

		it('disconnect() is safe to call when not connected', () => {
			expect(() => client.disconnect()).not.toThrow();
		});

		it('returns false after disconnect', async () => {
			const { proc } = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			await client.connect();

			client.disconnect();
			expect(client.isConnected()).toBe(false);
		});
	});

	// ─── getLastMessage() ─────────────────────────────────────────────────────
	describe('getLastMessage()', () => {
		it('returns empty string initially', () => {
			expect(client.getLastMessage()).toBe('');
		});
	});

	// ─── sendCommand() ────────────────────────────────────────────────────────
	describe('sendCommand()', () => {
		it('throws when not connected and cannot reconnect', async () => {
			// Connect will fail because spawn returns a proc with immediate exitCode
			const { proc } = createMockProcess();
			proc.exitCode = 1;
			mockSpawn.mockReturnValue(proc);

			await expect(client.sendCommand('list-windows')).rejects.toThrow();
		});
	});

	// ─── windowExists() ───────────────────────────────────────────────────────
	describe('windowExists()', () => {
		it('returns true when window is in the internal map', async () => {
			const privateClient = client as unknown as {
				windowToPaneId: Map<string, string>;
			};
			privateClient.windowToPaneId.set('known-window', '%1');

			// Short-circuits via in-memory map lookup
			const exists = await client.windowExists('known-window');
			expect(exists).toBe(true);
		});
	});

	// ─── parseLine protocol ────────────────────────────────────────────────────
	describe('parseLine protocol parsing', () => {
		it('accumulates output lines between %begin and %end markers', () => {
			const privateClient = client as unknown as {
				parseLine: (line: string) => void;
				currentBlock: { lines: string[] } | null;
				pendingCommand: {
					resolve: (v: string) => void;
					reject: (e: Error) => void;
				} | null;
			};

			let resolved: string | undefined;
			privateClient.pendingCommand = {
				resolve: (v) => {
					resolved = v;
				},
				reject: vi.fn(),
			};

			privateClient.parseLine('%begin 123 456');
			privateClient.parseLine('window-name-1');
			privateClient.parseLine('window-name-2');
			privateClient.parseLine('%end 123 456');

			expect(resolved).toBe('window-name-1\nwindow-name-2');
		});

		it('resolves with empty string for empty block', () => {
			const privateClient = client as unknown as {
				parseLine: (line: string) => void;
				pendingCommand: {
					resolve: (v: string) => void;
					reject: (e: Error) => void;
				} | null;
			};

			let resolved: string | undefined;
			privateClient.pendingCommand = {
				resolve: (v) => {
					resolved = v;
				},
				reject: vi.fn(),
			};

			privateClient.parseLine('%begin 100 200');
			privateClient.parseLine('%end 100 200');

			expect(resolved).toBe('');
		});

		it('buffers %output lines in paneOutputs', () => {
			const privateClient = client as unknown as {
				parseLine: (line: string) => void;
				paneOutputs: Map<string, string[]>;
			};

			// %output <paneId> <escaped-content>
			// \012 is the octal escape for newline
			privateClient.parseLine('%output %1 hello\\012world');

			const buffer = privateClient.paneOutputs.get('%1');
			expect(buffer).toBeDefined();
			expect(buffer?.join('')).toContain('hello');
		});

		it('stores %message content in lastMessage', () => {
			const privateClient = client as unknown as {
				parseLine: (line: string) => void;
				lastMessage: string;
			};

			privateClient.parseLine('%message something happened');

			expect(privateClient.lastMessage).toBe('something happened');
		});

		it('ignores known notification prefixes silently', () => {
			const privateClient = client as unknown as {
				parseLine: (line: string) => void;
				currentBlock: { lines: string[] } | null;
			};

			// No block open — these should just be ignored
			privateClient.parseLine('%session-created $0');
			privateClient.parseLine('%window-add @0');
			privateClient.parseLine('%pane-mode-changed %0');
			privateClient.parseLine('%exit');
			privateClient.parseLine('%layout-change $0 @0');

			// If we get here without error and block is null, the test passes
			expect(privateClient.currentBlock).toBeNull();
		});

		it('does not resolve pending command on %error when no pending command', () => {
			const privateClient = client as unknown as {
				parseLine: (line: string) => void;
				pendingCommand: unknown;
			};

			// Should not throw even with no pending command
			privateClient.parseLine('%begin 1 2');
			privateClient.parseLine('%error 1 2');

			expect(privateClient.pendingCommand).toBeNull();
		});
	});

	// ─── createWindow() wraps command in exit marker shell ───────────────────
	describe('createWindow()', () => {
		it('issues new-window command and stores pane ID mapping', async () => {
			const privateClient = client as unknown as {
				sendCommand: (cmd: string) => Promise<string>;
			};

			const sendCommandSpy = vi
				.spyOn(privateClient, 'sendCommand')
				.mockResolvedValueOnce('%1') // new-window response
				.mockResolvedValueOnce(''); // set-option response

			const paneId = await client.createWindow('my-window', 'echo hello');

			expect(paneId).toBe('%1');
			expect(sendCommandSpy).toHaveBeenCalledWith(expect.stringContaining('new-window'));
			expect(sendCommandSpy).toHaveBeenCalledWith(expect.stringContaining('my-window'));

			// Should also store the mapping
			expect(client.getOutput('my-window')).toBe('');

			sendCommandSpy.mockRestore();
		});

		it('base64-encodes command to handle special characters', async () => {
			const privateClient = client as unknown as {
				sendCommand: (cmd: string) => Promise<string>;
			};

			const sendCommandSpy = vi
				.spyOn(privateClient, 'sendCommand')
				.mockResolvedValueOnce('%2')
				.mockResolvedValueOnce('');

			const command = 'echo "hello world" && ls -la';
			await client.createWindow('test-window', command);

			// The command should be base64-encoded in the sent command
			const encodedCommand = Buffer.from(command).toString('base64');
			expect(sendCommandSpy).toHaveBeenCalledWith(expect.stringContaining(encodedCommand));

			sendCommandSpy.mockRestore();
		});
	});

	// ─── killWindow() ─────────────────────────────────────────────────────────
	describe('killWindow()', () => {
		it('removes window from internal maps and sends kill-window command', async () => {
			const privateClient = client as unknown as {
				windowToPaneId: Map<string, string>;
				paneOutputs: Map<string, string[]>;
				sendCommand: (cmd: string) => Promise<string>;
			};
			privateClient.windowToPaneId.set('to-kill', '%5');
			privateClient.paneOutputs.set('%5', ['some output']);

			const sendCommandSpy = vi.spyOn(privateClient, 'sendCommand').mockResolvedValueOnce('');

			await client.killWindow('to-kill');

			expect(privateClient.windowToPaneId.has('to-kill')).toBe(false);
			expect(privateClient.paneOutputs.has('%5')).toBe(false);
			expect(sendCommandSpy).toHaveBeenCalledWith(expect.stringContaining('kill-window'));
			sendCommandSpy.mockRestore();
		});

		it('still sends kill-window for windows not in internal map', async () => {
			const privateClient = client as unknown as {
				sendCommand: (cmd: string) => Promise<string>;
			};

			const sendCommandSpy = vi.spyOn(privateClient, 'sendCommand').mockResolvedValueOnce('');

			await client.killWindow('external-window');

			expect(sendCommandSpy).toHaveBeenCalledWith(expect.stringContaining('kill-window'));
			sendCommandSpy.mockRestore();
		});
	});

	// ─── sendKeys() ──────────────────────────────────────────────────────────
	describe('sendKeys()', () => {
		it('sends send-keys command with Enter when enter=true', async () => {
			const privateClient = client as unknown as {
				sendCommand: (cmd: string) => Promise<string>;
			};

			const sendCommandSpy = vi.spyOn(privateClient, 'sendCommand').mockResolvedValueOnce('');

			await client.sendKeys('my-window', 'npm test', true);

			expect(sendCommandSpy).toHaveBeenCalledWith(expect.stringMatching(/send-keys.*Enter/));

			sendCommandSpy.mockRestore();
		});

		it('sends send-keys command without Enter when enter=false', async () => {
			const privateClient = client as unknown as {
				sendCommand: (cmd: string) => Promise<string>;
			};

			const sendCommandSpy = vi.spyOn(privateClient, 'sendCommand').mockResolvedValueOnce('');

			await client.sendKeys('my-window', 'C-c', false);

			const calledWith = sendCommandSpy.mock.calls[0][0] as string;
			expect(calledWith).toContain('send-keys');
			expect(calledWith).not.toContain(' Enter');

			sendCommandSpy.mockRestore();
		});
	});
});
