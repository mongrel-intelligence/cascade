import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ListDirectory } from '../../gadgets/ListDirectory.js';
import type { ContextFile } from '../utils/setup.js';
import { type TrackingContext, recordSyntheticInvocationId } from '../utils/tracking.js';
import type { BuilderType } from './builderFactory.js';

/**
 * Helper to inject a single synthetic gadget call with tracking.
 */
export function injectSyntheticCall(
	builder: BuilderType,
	trackingContext: TrackingContext,
	gadgetName: string,
	params: Record<string, unknown>,
	result: string,
	invocationId: string,
): BuilderType {
	recordSyntheticInvocationId(trackingContext, invocationId);
	return builder.withSyntheticGadgetCall(gadgetName, params, result, invocationId);
}

/**
 * Inject directory listing as synthetic ListDirectory call.
 */
export function injectDirectoryListing(
	builder: BuilderType,
	trackingContext: TrackingContext,
	maxDepth = 3,
): BuilderType {
	const listDirGadget = new ListDirectory();
	const listDirParams = {
		comment: 'Pre-fetching codebase structure for context',
		directoryPath: '.',
		maxDepth,
		includeGitIgnored: false,
	};
	const listDirResult = listDirGadget.execute(listDirParams);
	return injectSyntheticCall(
		builder,
		trackingContext,
		'ListDirectory',
		listDirParams,
		listDirResult,
		'gc_dir',
	);
}

/**
 * Inject context files (CLAUDE.md, AGENTS.md, etc.) as synthetic ReadFile calls.
 */
export function injectContextFiles(
	builder: BuilderType,
	trackingContext: TrackingContext,
	contextFiles: ContextFile[],
): BuilderType {
	let result = builder;
	for (let i = 0; i < contextFiles.length; i++) {
		const file = contextFiles[i];
		const invocationId = `gc_init_${i + 1}`;
		result = injectSyntheticCall(
			result,
			trackingContext,
			'ReadFile',
			{ comment: `Pre-fetching ${file.path} for project context`, filePath: file.path },
			file.content,
			invocationId,
		);
	}
	return result;
}

/**
 * Inject Squint overview if enabled (gives agent immediate codebase context).
 */
export function injectSquintContext(
	builder: BuilderType,
	trackingContext: TrackingContext,
	repoDir: string,
): BuilderType {
	const squintDb = join(repoDir, '.squint.db');
	if (!existsSync(squintDb)) return builder;

	try {
		const output = execFileSync('squint', ['overview', '-d', squintDb], {
			encoding: 'utf-8',
			timeout: 30_000,
		});

		if (!output || !output.trim()) return builder;

		return injectSyntheticCall(
			builder,
			trackingContext,
			'SquintOverview',
			{ comment: 'Pre-fetching Squint codebase overview for context', database: squintDb },
			output,
			'gc_squint_overview',
		);
	} catch {
		// Squint command failed, continue without it
		return builder;
	}
}
