import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { auList, auRead } from '@zbigniewsobiecki/au';

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
 * Inject AU understanding if enabled (gives agent immediate codebase context).
 */
export async function injectAUContext(
	builder: BuilderType,
	trackingContext: TrackingContext,
	repoDir: string,
): Promise<BuilderType> {
	const auEnabled = existsSync(join(repoDir, '.au'));
	if (!auEnabled) return builder;

	let result = builder;

	const auListResult = (await auList.execute({
		comment: 'Pre-fetching AU entries for context',
		path: '.',
	})) as string;

	if (!auListResult || auListResult.includes('No AU entries found')) {
		return result;
	}

	result = injectSyntheticCall(
		result,
		trackingContext,
		'AUList',
		{ comment: 'Pre-fetching AU entries for context', path: '.' },
		auListResult,
		'gc_au_list',
	);

	const auReadResult = (await auRead.execute({
		comment: 'Pre-fetching root-level understanding',
		paths: '.',
	})) as string;

	if (auReadResult && !auReadResult.includes('No understanding exists yet')) {
		result = injectSyntheticCall(
			result,
			trackingContext,
			'AURead',
			{ comment: 'Pre-fetching root-level understanding', paths: '.' },
			auReadResult,
			'gc_au_read',
		);
	}

	return result;
}
