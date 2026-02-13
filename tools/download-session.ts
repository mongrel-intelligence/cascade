#!/usr/bin/env tsx
/**
 * Download LLM session data from a Trello card for debugging.
 *
 * Usage:
 *   bun run tool:download-session https://trello.com/c/abc123/card-name
 *   bun run tool:download-session abc123
 */

import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import AdmZip from 'adm-zip';
import { trelloClient } from '../src/trello/client.js';

function extractCardId(input: string): string {
	// Match Trello URL: https://trello.com/c/abc123/... or https://trello.com/c/abc123
	const urlMatch = input.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
	if (urlMatch) {
		return urlMatch[1];
	}
	// Assume it's already a card ID
	return input;
}

async function downloadFile(url: string): Promise<Buffer> {
	const response = await fetch(url, {
		headers: {
			Authorization: `OAuth oauth_consumer_key="${process.env.TRELLO_API_KEY}", oauth_token="${process.env.TRELLO_TOKEN}"`,
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to download ${url}: ${response.status}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

async function downloadAndUnzip(url: string, destPath: string): Promise<void> {
	const buffer = await downloadFile(url);

	// Check if it's actually a ZIP file (magic bytes: PK\x03\x04)
	if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
		// It's a ZIP file, extract it
		const zip = new AdmZip(buffer);
		const entries = zip.getEntries();
		// Extract first file to destPath
		if (entries.length > 0) {
			await writeFile(destPath, entries[0].getData());
		}
		return;
	}

	// Try gzip decompression
	const gunzip = createGunzip();
	const output = createWriteStream(destPath);
	const nodeStream = Readable.from(buffer);
	await pipeline(nodeStream, gunzip, output);
}

async function downloadAndExtractZip(url: string, destDir: string): Promise<string[]> {
	// Trello attachments require OAuth header for auth
	const response = await fetch(url, {
		headers: {
			Authorization: `OAuth oauth_consumer_key="${process.env.TRELLO_API_KEY}", oauth_token="${process.env.TRELLO_TOKEN}"`,
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to download ${url}: ${response.status}`);
	}

	// Download to buffer
	const buffer = Buffer.from(await response.arrayBuffer());

	// Extract ZIP
	const zip = new AdmZip(buffer);
	const entries = zip.getEntries();
	const extractedFiles: string[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory) {
			const destPath = join(destDir, entry.entryName);
			await mkdir(join(destDir, entry.entryName.split('/').slice(0, -1).join('/')), {
				recursive: true,
			});
			await writeFile(destPath, entry.getData());
			extractedFiles.push(entry.entryName);
		}
	}

	return extractedFiles;
}

type Attachment = Awaited<ReturnType<typeof trelloClient.getCardAttachments>>[0];

async function downloadGzAttachments(attachments: Attachment[], sessionDir: string): Promise<void> {
	const gzAttachments = attachments.filter((a) => a.name.endsWith('.gz'));
	if (gzAttachments.length === 0) return;

	console.log(`Downloading ${gzAttachments.length} .gz attachments...`);

	for (const attachment of gzAttachments) {
		const destName = attachment.name.replace(/\.gz$/, '');
		const destPath = join(sessionDir, destName);
		console.log(`  ${attachment.name} -> ${destName}`);

		try {
			await downloadAndUnzip(attachment.url, destPath);
		} catch (err) {
			console.error(`  Failed to download ${attachment.name}:`, err);
		}
	}
}

async function downloadZipAttachments(
	attachments: Attachment[],
	sessionDir: string,
): Promise<void> {
	const zipAttachments = attachments.filter((a) => a.name.endsWith('.zip'));
	if (zipAttachments.length === 0) return;

	console.log(`Downloading ${zipAttachments.length} .zip attachments...`);

	for (const attachment of zipAttachments) {
		console.log(`  ${attachment.name}:`);

		try {
			// Extract each zip to its own subdirectory to prevent file collisions
			const subDir = join(sessionDir, attachment.name.replace(/\.zip$/, ''));
			await mkdir(subDir, { recursive: true });
			const files = await downloadAndExtractZip(attachment.url, subDir);
			for (const file of files) {
				console.log(`    -> ${file}`);
			}
		} catch (err) {
			console.error(`  Failed to download ${attachment.name}:`, err);
		}
	}
}

async function main() {
	const input = process.argv[2];

	if (!input) {
		console.error('Usage: bun run tool:download-session <trello-card-url-or-id>');
		process.exit(1);
	}

	const cardId = extractCardId(input);
	console.log(`Fetching card: ${cardId}`);

	// Create temp directory
	const sessionDir = join(tmpdir(), `session-${cardId}-${Date.now()}`);
	await mkdir(sessionDir, { recursive: true });

	// Fetch card data in parallel
	const [card, comments, checklists, attachments] = await Promise.all([
		trelloClient.getCard(cardId),
		trelloClient.getCardComments(cardId),
		trelloClient.getCardChecklists(cardId),
		trelloClient.getCardAttachments(cardId),
	]);

	console.log(`Card: ${card.name}`);
	console.log(`Comments: ${comments.length}`);
	console.log(`Checklists: ${checklists.length}`);
	console.log(`Attachments: ${attachments.length}`);

	// Save card metadata
	const cardData = {
		id: card.id,
		name: card.name,
		description: card.desc,
		url: card.url,
		labels: card.labels,
		checklists: checklists.map((cl) => ({
			name: cl.name,
			items: cl.checkItems.map((item) => ({
				name: item.name,
				state: item.state,
			})),
		})),
		comments: comments.map((c) => ({
			date: c.date,
			author: c.memberCreator.fullName,
			text: c.data.text,
		})),
	};

	await writeFile(join(sessionDir, 'card-data.json'), JSON.stringify(cardData, null, 2));

	// Download attachments
	await downloadGzAttachments(attachments, sessionDir);
	await downloadZipAttachments(attachments, sessionDir);

	console.log(`\nSession data saved to:\n${sessionDir}`);
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});
