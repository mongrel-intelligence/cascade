/**
 * Context file offloading for Claude Code backend.
 *
 * When context injections are too large to embed inline in the prompt,
 * this module writes them to files and generates instructions for Claude
 * to read them on-demand using its built-in Read tool.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CONTEXT_OFFLOAD_CONFIG } from '../../config/claudeCodeConfig.js';
import { estimateTokens } from '../../config/reviewConfig.js';
import { logger } from '../../utils/logging.js';
import type { ContextInjection } from '../types.js';

/**
 * Metadata about an offloaded context file.
 */
export interface OffloadedFile {
	/** Relative path from repo root, e.g. '.cascade/context/pr-diff.txt' */
	relativePath: string;
	/** Original description of this context */
	description: string;
	/** Estimated token count of the content */
	tokens: number;
}

/**
 * Result of context offloading.
 */
export interface ContextOffloadResult {
	/** Context injections small enough to embed inline */
	inlineInjections: ContextInjection[];
	/** Files that were written for large context */
	offloadedFiles: OffloadedFile[];
	/** Instructions for Claude to read the offloaded files */
	instructions: string;
}

/**
 * Convert a description string into a safe filename.
 * Includes index suffix to guarantee uniqueness within a batch.
 */
function slugify(description: string, index: number): string {
	const base = description
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40); // Shorter to make room for index

	// Always append index for guaranteed uniqueness within this batch
	return `${base || 'context'}-${index}`;
}

/**
 * Generate instructions for Claude to read offloaded context files.
 */
function generateReadInstructions(files: OffloadedFile[]): string {
	if (files.length === 0) return '';

	const lines = [
		'## Context Files',
		'',
		'The following context has been saved to files to avoid exceeding prompt limits.',
		'Use the Read tool to access them as needed:',
		'',
	];

	for (const file of files) {
		lines.push(
			`- \`${file.relativePath}\` — ${file.description} (~${file.tokens.toLocaleString()} tokens)`,
		);
	}

	lines.push('');
	lines.push('Read these files as needed for your task. For review tasks, start with the PR diff.');

	return lines.join('\n');
}

/**
 * Offload large context injections to files.
 *
 * Small context (below threshold) is kept inline.
 * Large context is written to .cascade/context/ and Claude is instructed to read it.
 *
 * @param repoDir - Repository directory where context files will be written
 * @param injections - Context injections to process
 * @returns Result with inline context, offloaded files, and instructions
 */
export async function offloadLargeContext(
	repoDir: string,
	injections: ContextInjection[],
): Promise<ContextOffloadResult> {
	if (!CONTEXT_OFFLOAD_CONFIG.enabled) {
		return {
			inlineInjections: injections,
			offloadedFiles: [],
			instructions: '',
		};
	}

	const inlineInjections: ContextInjection[] = [];
	const offloadedFiles: OffloadedFile[] = [];
	const contextDir = join(repoDir, CONTEXT_OFFLOAD_CONFIG.contextDir);
	let dirCreated = false;

	for (let i = 0; i < injections.length; i++) {
		const injection = injections[i];
		const tokens = estimateTokens(injection.result);

		if (tokens < CONTEXT_OFFLOAD_CONFIG.inlineThreshold) {
			inlineInjections.push(injection);
		} else {
			// Create context directory on first offload
			if (!dirCreated) {
				await mkdir(contextDir, { recursive: true });
				dirCreated = true;
			}

			// Generate unique filename from description (with index for uniqueness)
			const slug = slugify(injection.description, i);
			const filename = `${slug}.txt`;
			const filepath = join(contextDir, filename);
			// Use forward slashes for consistent paths in instructions (works on all platforms)
			const relativePath = `${CONTEXT_OFFLOAD_CONFIG.contextDir}/${filename}`;

			await writeFile(filepath, injection.result, 'utf-8');

			offloadedFiles.push({
				relativePath,
				description: injection.description,
				tokens,
			});

			logger.info('Context offloaded to file', {
				description: injection.description,
				tokens,
				path: relativePath,
			});
		}
	}

	const instructions = generateReadInstructions(offloadedFiles);

	if (offloadedFiles.length > 0) {
		logger.info('Context offload summary', {
			inlineCount: inlineInjections.length,
			offloadedCount: offloadedFiles.length,
			totalOffloadedTokens: offloadedFiles.reduce((sum, f) => sum + f.tokens, 0),
		});
	}

	return {
		inlineInjections,
		offloadedFiles,
		instructions,
	};
}

/**
 * Clean up context files after agent execution.
 *
 * Removes the .cascade/context/ directory and all its contents.
 *
 * @param repoDir - Repository directory
 */
export async function cleanupContextFiles(repoDir: string): Promise<void> {
	const contextDir = join(repoDir, CONTEXT_OFFLOAD_CONFIG.contextDir);
	try {
		await rm(contextDir, { recursive: true, force: true });
		logger.debug('Cleaned up context files', { contextDir });
	} catch {
		// Ignore errors (directory might not exist)
	}
}

/**
 * Build the inline context section for the prompt.
 */
export function buildInlineContextSection(injections: ContextInjection[]): string {
	if (injections.length === 0) return '';

	let section = '\n\n## Pre-loaded Context\n';
	for (const injection of injections) {
		section += `\n### ${injection.description} (${injection.toolName})\n`;
		section += `Parameters: ${JSON.stringify(injection.params)}\n`;
		section += `\`\`\`\n${injection.result}\n\`\`\`\n`;
	}
	return section;
}
