/**
 * OpenCode server lifecycle management.
 *
 * Handles port reservation, server process spawning, stdout/stderr capture,
 * and error formatting for the OpenCode HTTP server process.
 */

import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:net';

import type { Config } from '@opencode-ai/sdk/client';

import { appendEngineLog } from '../shared/engineLog.js';
import { buildEnv } from './env.js';

export interface OpenCodeServerState {
	stdout: string;
	stderr: string;
	exitCode?: number;
}

function withTrailingSlashRemoved(value: string): string {
	return value.endsWith('/') ? value.slice(0, -1) : value;
}

export async function reservePort(): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const server: Server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close(() => reject(new Error('Failed to reserve OpenCode server port')));
				return;
			}
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(address.port);
			});
		});
	});
}

export async function startOpenCodeServer(
	config: Config,
	projectSecrets: Record<string, string> | undefined,
	engineLogPath: string | undefined,
	cliToolsDir: string,
	nativeToolShimDir?: string,
): Promise<{ child: ReturnType<typeof spawn>; url: string }> {
	const port = await reservePort();
	const host = '127.0.0.1';
	const env = {
		...buildEnv(projectSecrets, cliToolsDir, nativeToolShimDir),
		OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
	};
	const args = ['serve', `--hostname=${host}`, `--port=${port}`];

	appendEngineLog(
		engineLogPath,
		`$ opencode ${args.map((arg) => JSON.stringify(arg)).join(' ')}\n`,
	);

	return await new Promise((resolve, reject) => {
		const child = spawn('opencode', args, {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		let settled = false;

		const finish = (handler: () => void) => {
			if (settled) return;
			settled = true;
			handler();
		};

		const onChunk = (chunk: Buffer | string) => {
			const text = chunk.toString();
			output += text;
			appendEngineLog(engineLogPath, text);
			for (const line of output.split('\n')) {
				if (!line.startsWith('opencode server listening')) continue;
				const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
				if (!match) continue;
				finish(() => resolve({ child, url: withTrailingSlashRemoved(match[1]) }));
				return;
			}
		};

		child.stdout.on('data', onChunk);
		child.stderr.on('data', onChunk);
		child.once('error', (error) => {
			finish(() => {
				reject(
					error instanceof Error && 'code' in error && error.code === 'ENOENT'
						? new Error(
								'OpenCode CLI not found in PATH. Install `opencode-ai` in the worker image.',
							)
						: error,
				);
			});
		});
		child.once('exit', (code) => {
			finish(() => {
				reject(
					new Error(
						`OpenCode server exited with code ${code ?? 1}${output.trim() ? `\n${output}` : ''}`,
					),
				);
			});
		});
	});
}

export function attachServerState(
	server: Awaited<ReturnType<typeof startOpenCodeServer>>,
	serverState: OpenCodeServerState,
): void {
	server.child.stdout?.on('data', (chunk: Buffer | string) => {
		serverState.stdout += chunk.toString();
	});
	server.child.stderr?.on('data', (chunk: Buffer | string) => {
		serverState.stderr += chunk.toString();
	});
	server.child.once('exit', (code) => {
		serverState.exitCode = code ?? 1;
	});
}

export function summarizeServerOutput(serverState: OpenCodeServerState): string | undefined {
	const summary = [serverState.stderr.trim(), serverState.stdout.trim()].filter(Boolean).join('\n');
	if (!summary) return undefined;
	return summary.length > 500 ? `${summary.slice(0, 500)}...` : summary;
}

export function formatOpenCodeServerExitError(serverState: OpenCodeServerState): string {
	const summary = summarizeServerOutput(serverState);
	return summary
		? `OpenCode server exited unexpectedly with code ${serverState.exitCode ?? 1}: ${summary}`
		: `OpenCode server exited unexpectedly with code ${serverState.exitCode ?? 1}`;
}
