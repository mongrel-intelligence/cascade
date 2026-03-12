import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface NativeToolRuntimeArtifacts {
	shimDir: string;
	cleanup: () => void;
}

export function createNativeToolRuntimeArtifacts(): NativeToolRuntimeArtifacts {
	const shimDir = join(tmpdir(), `cascade-native-tools-${process.pid}-${Date.now()}`);
	mkdirSync(shimDir, { recursive: true });

	const ghShimPath = join(shimDir, 'gh');
	writeFileSync(
		ghShimPath,
		[
			'#!/bin/sh',
			'echo "gh is unavailable in CASCADE agent runs. Use cascade-tools scm create-pr or other cascade-tools commands instead." >&2',
			'exit 1',
			'',
		].join('\n'),
		'utf-8',
	);
	chmodSync(ghShimPath, 0o755);

	return {
		shimDir,
		cleanup: () => {
			try {
				rmSync(shimDir, { recursive: true, force: true });
			} catch {
				// Best-effort cleanup
			}
		},
	};
}

export function buildNativeToolPath(
	basePath: string | undefined,
	cliToolsDir: string,
	shimDir?: string,
): string {
	const pathEntries = [shimDir, cliToolsDir, basePath].filter(
		(entry): entry is string => typeof entry === 'string' && entry.length > 0,
	);
	return pathEntries.join(':');
}
