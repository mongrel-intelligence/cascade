import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { execa } from 'execa';
import treeKill from 'tree-kill';
import { getProjectGitHubToken } from '../config/projects.js';
import type { ProjectConfig } from '../types/index.js';
import { logger } from './logging.js';

/**
 * Parse a GitHub "owner/repo" full name string into its components.
 * Throws if the format is malformed.
 */
export function parseRepoFullName(fullName: string): { owner: string; repo: string } {
	const slashIdx = fullName.indexOf('/');
	if (slashIdx <= 0 || slashIdx === fullName.length - 1) {
		throw new Error(`Invalid repository full name: "${fullName}". Expected "owner/repo" format.`);
	}
	const owner = fullName.slice(0, slashIdx);
	const repo = fullName.slice(slashIdx + 1);
	return { owner, repo };
}

/**
 * Get the base directory for temporary files (repos, logs).
 * Uses CASCADE_WORKSPACE_DIR env var if set, otherwise /workspace.
 */
export function getWorkspaceDir(): string {
	return process.env.CASCADE_WORKSPACE_DIR || '/workspace';
}

export function createTempDir(projectId: string): string {
	const baseDir = getWorkspaceDir();
	const tempDir = `${baseDir}/cascade-${projectId}-${Date.now()}`;
	mkdirSync(tempDir, { recursive: true });
	return tempDir;
}

export async function cloneRepo(
	project: ProjectConfig,
	targetDir: string,
	token?: string,
): Promise<void> {
	if (!project.repo) {
		throw new Error(`Cannot clone repository: project '${project.id}' has no repo configured`);
	}
	const cloneToken = token ?? (await getProjectGitHubToken(project));
	const cloneUrl = `https://${cloneToken}@github.com/${project.repo}.git`;

	const branch = project.baseBranch ?? 'main';
	logger.info('Cloning repository', { repo: project.repo, targetDir, branch });

	execSync(`git clone --branch ${branch} ${cloneUrl} ${targetDir}`, {
		stdio: 'pipe',
		env: { ...process.env },
	});

	// Configure git user for commits
	execSync('git config user.name "Cascade Bot"', { cwd: targetDir, stdio: 'pipe' });
	execSync('git config user.email "bot@cascade.dev"', { cwd: targetDir, stdio: 'pipe' });

	logger.info('Repository cloned and configured');
}

export function cleanupTempDir(dir: string): void {
	const workspaceDir = getWorkspaceDir();
	if (existsSync(dir) && dir.startsWith(`${workspaceDir}/cascade-`)) {
		logger.debug('Cleaning up temp directory', { dir });
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Options for {@link runCommand}.
 *
 * All timing fields are in milliseconds. Setting a timing field to `0` disables it.
 * Spec 013: the defaults balance noise against agent-observability — fast calls
 * (ms-scale) never hit the heartbeat or idle timer, slow calls (git push with hooks)
 * emit progress and are killed cleanly if wedged.
 */
export type RunCommandOptions = {
	/** Emit a heartbeat on parent stderr every N ms of child silence. Default 30_000. Set to 0 to disable. */
	heartbeatMs?: number;
	/** Kill child if no output for N ms. Default 120_000. Set to 0 to disable. */
	idleTimeoutMs?: number;
	/** Kill child after N ms of total runtime. Default 600_000. Set to 0 to disable. */
	wallTimeoutMs?: number;
	/** After SIGTERM, wait N ms before SIGKILL. Default 5_000. */
	forceKillAfterMs?: number;
	/** Short label emitted in heartbeat lines. Defaults to `command`. */
	label?: string;
	/** Suppress streaming and heartbeats. Capture-only. Default false. */
	silent?: boolean;
};

export type RunCommandResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
	/** Set when the helper's timeouts fired. Undefined on natural exit. */
	reason?: 'idle-timeout' | 'wall-timeout';
};

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;
const DEFAULT_WALL_TIMEOUT_MS = 600_000;
const DEFAULT_FORCE_KILL_AFTER_MS = 5_000;

/**
 * Internal. Manages the three timers (heartbeat, idle, wall) + SIGTERM→SIGKILL
 * ladder for a subprocess. Returned handle's `noteOutput` resets heartbeat + idle.
 */
type WatcherHandle = {
	noteOutput: () => void;
	dispose: () => void;
	getReason: () => 'idle-timeout' | 'wall-timeout' | undefined;
};

function createSubprocessWatcher(
	pid: number | undefined,
	config: {
		heartbeatMs: number;
		idleTimeoutMs: number;
		wallTimeoutMs: number;
		forceKillAfterMs: number;
		label: string;
		silent: boolean;
	},
	startMs: number,
): WatcherHandle {
	const { heartbeatMs, idleTimeoutMs, wallTimeoutMs, forceKillAfterMs, label, silent } = config;
	let reason: 'idle-timeout' | 'wall-timeout' | undefined;
	let heartbeatTimer: NodeJS.Timeout | null = null;
	let idleTimer: NodeJS.Timeout | null = null;
	let wallTimer: NodeJS.Timeout | null = null;
	let forceKillTimer: NodeJS.Timeout | null = null;

	const killTree = (signal: 'SIGTERM' | 'SIGKILL') => {
		if (pid) treeKill(pid, signal, () => {});
	};

	const scheduleForceKill = () => {
		if (forceKillTimer || forceKillAfterMs <= 0) return;
		forceKillTimer = setTimeout(() => killTree('SIGKILL'), forceKillAfterMs);
	};

	const onTimeout = (kind: 'idle-timeout' | 'wall-timeout') => {
		reason = kind;
		killTree('SIGTERM');
		scheduleForceKill();
	};

	const armHeartbeat = () => {
		if (silent || heartbeatMs <= 0) return;
		if (heartbeatTimer) clearTimeout(heartbeatTimer);
		const tick = () => {
			const elapsedS = Math.round((Date.now() - startMs) / 1000);
			process.stderr.write(`[${label}] still running (${elapsedS}s)\n`);
			heartbeatTimer = setTimeout(tick, heartbeatMs);
		};
		heartbeatTimer = setTimeout(tick, heartbeatMs);
	};

	const armIdle = () => {
		if (idleTimeoutMs <= 0) return;
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => onTimeout('idle-timeout'), idleTimeoutMs);
	};

	if (wallTimeoutMs > 0) {
		wallTimer = setTimeout(() => onTimeout('wall-timeout'), wallTimeoutMs);
	}
	armIdle();
	armHeartbeat();

	return {
		noteOutput: () => {
			armIdle();
			armHeartbeat();
		},
		dispose: () => {
			if (heartbeatTimer) clearTimeout(heartbeatTimer);
			if (idleTimer) clearTimeout(idleTimer);
			if (wallTimer) clearTimeout(wallTimer);
			if (forceKillTimer) clearTimeout(forceKillTimer);
		},
		getReason: () => reason,
	};
}

function resolveOptions(
	command: string,
	options: RunCommandOptions | undefined,
): {
	heartbeatMs: number;
	idleTimeoutMs: number;
	wallTimeoutMs: number;
	forceKillAfterMs: number;
	label: string;
	silent: boolean;
} {
	return {
		heartbeatMs: options?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
		idleTimeoutMs: options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
		wallTimeoutMs: options?.wallTimeoutMs ?? DEFAULT_WALL_TIMEOUT_MS,
		forceKillAfterMs: options?.forceKillAfterMs ?? DEFAULT_FORCE_KILL_AFTER_MS,
		label: options?.label ?? command,
		silent: options?.silent ?? false,
	};
}

/**
 * Spawn a subprocess and return captured output + exit code.
 *
 * Spec 013 behavior: streams child stdout/stderr to the parent's stderr as they
 * arrive (line-buffered), emits a periodic heartbeat line during child silence,
 * enforces both an idle-silence timeout and a wall-clock timeout, kills the
 * child AND its descendants via tree-kill on timeout (SIGTERM → SIGKILL after a
 * grace window), and preserves captured output on success and failure alike.
 *
 * All options are configurable per call with safe defaults; callers who want
 * different numbers (e.g. a push that should not exceed the gadget's 240s budget)
 * pass explicit values.
 */
export async function runCommand(
	command: string,
	args: string[],
	cwd: string,
	env?: Record<string, string>,
	options?: RunCommandOptions,
): Promise<RunCommandResult> {
	const config = resolveOptions(command, options);
	const child = execa(command, args, {
		cwd,
		env: { ...process.env, ...env },
		reject: false,
		encoding: 'utf8',
	});

	const watcher = createSubprocessWatcher(child.pid, config, Date.now());
	const capture = { stdout: '', stderr: '' };
	const onChunk = (chunk: unknown, kind: 'stdout' | 'stderr') => {
		const text = typeof chunk === 'string' ? chunk : String(chunk);
		capture[kind] += text;
		if (!config.silent) process.stderr.write(text);
		watcher.noteOutput();
	};
	child.stdout?.on('data', (c) => onChunk(c, 'stdout'));
	child.stderr?.on('data', (c) => onChunk(c, 'stderr'));

	try {
		const result = await child;
		const stdout = capture.stdout || (typeof result.stdout === 'string' ? result.stdout : '');
		const stderr = capture.stderr || (typeof result.stderr === 'string' ? result.stderr : '');
		const reason = watcher.getReason();
		const exitCode = typeof result.exitCode === 'number' ? result.exitCode : reason ? 143 : 1;
		return { stdout, stderr, exitCode, reason };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			stdout: capture.stdout,
			stderr: capture.stderr + msg,
			exitCode: 1,
			reason: watcher.getReason(),
		};
	} finally {
		watcher.dispose();
	}
}
