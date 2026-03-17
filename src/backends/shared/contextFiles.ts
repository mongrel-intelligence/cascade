/**
 * Context file offloading for native-tool backends.
 *
 * When context injections are too large to embed inline in the prompt,
 * this module writes them to files and generates instructions for the agent
 * to read them on-demand using its built-in Read tool.
 *
 * When context injections contain images, each image is written as a binary
 * file to `.cascade/context/images/` so native-tool engines (Claude Code,
 * OpenCode, Codex) can read them with their built-in Read tool.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CONTEXT_OFFLOAD_CONFIG } from '../../config/claudeCodeConfig.js';
import { estimateTokens } from '../../config/reviewConfig.js';
import { logger } from '../../utils/logging.js';
import type { ContextInjection } from '../types.js';

/** Subdirectory under contextDir where images are written. */
const IMAGES_SUBDIR = 'images';

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
 * Metadata about an offloaded context image.
 */
export interface OffloadedImage {
	/** Relative path from repo root, e.g. '.cascade/context/images/work-item-0-img-0.png' */
	relativePath: string;
	/** Optional alt text describing the image */
	altText?: string;
}

/**
 * Result of context offloading.
 */
export interface ContextOffloadResult {
	/** Context injections small enough to embed inline */
	inlineInjections: ContextInjection[];
	/** Files that were written for large context */
	offloadedFiles: OffloadedFile[];
	/** Image files written for context injections that included images */
	offloadedImages: OffloadedImage[];
	/** Instructions for the agent to read the offloaded files */
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
 * Derive an image file extension from a MIME type.
 */
function mimeToExtension(mimeType: string): string {
	const ext = mimeType.split('/')[1];
	// Normalise: 'jpeg' → 'jpg' for brevity; keep others as-is
	if (ext === 'jpeg') return 'jpg';
	return ext ?? 'bin';
}

/**
 * Generate instructions for the agent to read offloaded context files.
 */
function generateReadInstructions(files: OffloadedFile[], images: OffloadedImage[]): string {
	if (files.length === 0 && images.length === 0) return '';

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

	if (images.length > 0) {
		if (files.length > 0) lines.push('');
		lines.push(
			`The following context images have been saved to \`${CONTEXT_OFFLOAD_CONFIG.contextDir}/${IMAGES_SUBDIR}/\`:`,
		);
		lines.push('');
		for (const img of images) {
			const desc = img.altText ? ` — ${img.altText}` : '';
			lines.push(`- \`${img.relativePath}\`${desc}`);
		}
	}

	lines.push('');
	lines.push('Read these files as needed for your task. For review tasks, start with the PR diff.');

	return lines.join('\n');
}

/**
 * Write a single context image to disk.
 * Returns an OffloadedImage on success, or null on failure (with a warning logged).
 */
async function writeContextImage(
	imagesDir: string,
	injectionSlug: string,
	imageIndex: number,
	img: NonNullable<ContextInjection['images']>[number],
	description: string,
): Promise<OffloadedImage | null> {
	const ext = mimeToExtension(img.mimeType);
	const imageFilename = `${injectionSlug}-img-${imageIndex}.${ext}`;
	const imageRelativePath = `${CONTEXT_OFFLOAD_CONFIG.contextDir}/${IMAGES_SUBDIR}/${imageFilename}`;

	try {
		const imageBuffer = Buffer.from(img.base64Data, 'base64');
		await writeFile(join(imagesDir, imageFilename), imageBuffer);

		logger.info('Context image written to file', {
			description,
			imageIndex,
			mimeType: img.mimeType,
			path: imageRelativePath,
		});

		return { relativePath: imageRelativePath, altText: img.altText };
	} catch (err) {
		// Graceful degradation: log and continue without this image
		logger.warn('Failed to write context image to file — skipping', {
			description,
			imageIndex,
			mimeType: img.mimeType,
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}

/**
 * Write all images from a single injection to the images subdirectory.
 */
async function writeInjectionImages(
	contextDir: string,
	injection: ContextInjection,
	injectionIndex: number,
	createdDirs: { context: boolean; images: boolean },
): Promise<OffloadedImage[]> {
	if (!injection.images || injection.images.length === 0) return [];

	const imagesDir = join(contextDir, IMAGES_SUBDIR);

	if (!createdDirs.context) {
		await mkdir(contextDir, { recursive: true });
		createdDirs.context = true;
	}
	if (!createdDirs.images) {
		await mkdir(imagesDir, { recursive: true });
		createdDirs.images = true;
	}

	const slug = slugify(injection.description, injectionIndex);
	const results: OffloadedImage[] = [];

	for (let j = 0; j < injection.images.length; j++) {
		const offloaded = await writeContextImage(
			imagesDir,
			slug,
			j,
			injection.images[j],
			injection.description,
		);
		if (offloaded) results.push(offloaded);
	}

	return results;
}

/**
 * Offload large context injections to files.
 *
 * Small context (below threshold) is kept inline.
 * Large context is written to .cascade/context/ and the agent is instructed to read it.
 *
 * Images from any ContextInjection (regardless of size) are written to
 * .cascade/context/images/ as binary files that native-tool engines can read.
 *
 * @param repoDir - Repository directory where context files will be written
 * @param injections - Context injections to process
 * @returns Result with inline context, offloaded files, image files, and instructions
 */
export async function offloadLargeContext(
	repoDir: string,
	injections: ContextInjection[],
): Promise<ContextOffloadResult> {
	if (!CONTEXT_OFFLOAD_CONFIG.enabled) {
		return {
			inlineInjections: injections,
			offloadedFiles: [],
			offloadedImages: [],
			instructions: '',
		};
	}

	const inlineInjections: ContextInjection[] = [];
	const offloadedFiles: OffloadedFile[] = [];
	const offloadedImages: OffloadedImage[] = [];
	const contextDir = join(repoDir, CONTEXT_OFFLOAD_CONFIG.contextDir);
	// Track which dirs have been created to avoid redundant mkdir calls
	const createdDirs = { context: false, images: false };

	for (let i = 0; i < injections.length; i++) {
		const injection = injections[i];
		const tokens = estimateTokens(injection.result);

		if (tokens < CONTEXT_OFFLOAD_CONFIG.inlineThreshold) {
			inlineInjections.push(injection);
		} else {
			// Create context directory on first offload
			if (!createdDirs.context) {
				await mkdir(contextDir, { recursive: true });
				createdDirs.context = true;
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

		// Write images for this injection (regardless of whether text was offloaded)
		const injectionImages = await writeInjectionImages(contextDir, injection, i, createdDirs);
		offloadedImages.push(...injectionImages);
	}

	const instructions = generateReadInstructions(offloadedFiles, offloadedImages);

	if (offloadedFiles.length > 0 || offloadedImages.length > 0) {
		logger.info('Context offload summary', {
			inlineCount: inlineInjections.length,
			offloadedCount: offloadedFiles.length,
			imageCount: offloadedImages.length,
			totalOffloadedTokens: offloadedFiles.reduce((sum, f) => sum + f.tokens, 0),
		});
	}

	return {
		inlineInjections,
		offloadedFiles,
		offloadedImages,
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
 * When an injection has images, a note is added indicating their count.
 */
export function buildInlineContextSection(injections: ContextInjection[]): string {
	if (injections.length === 0) return '';

	let section = '\n\n## Pre-loaded Context\n';
	for (const injection of injections) {
		section += `\n### ${injection.description} (${injection.toolName})\n`;
		section += `Parameters: ${JSON.stringify(injection.params)}\n`;
		if (injection.images && injection.images.length > 0) {
			section += `Contains ${injection.images.length} inline image${injection.images.length === 1 ? '' : 's'} — see \`${CONTEXT_OFFLOAD_CONFIG.contextDir}/${IMAGES_SUBDIR}/\`\n`;
		}
		section += `\`\`\`\n${injection.result}\n\`\`\`\n`;
	}
	return section;
}
