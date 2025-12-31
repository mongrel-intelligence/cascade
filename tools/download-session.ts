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

async function downloadAndUnzip(url: string, destPath: string): Promise<void> {
	// Trello attachments require OAuth header for auth
	const response = await fetch(url, {
		headers: {
			Authorization: `OAuth oauth_consumer_key="${process.env.TRELLO_API_KEY}", oauth_token="${process.env.TRELLO_TOKEN}"`,
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to download ${url}: ${response.status}`);
	}

	const gunzip = createGunzip();
	const output = createWriteStream(destPath);

	// Convert web ReadableStream to Node Readable
	const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
	await pipeline(nodeStream, gunzip, output);
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

	// Download .gz attachments
	const gzAttachments = attachments.filter((a) => a.name.endsWith('.gz'));
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

	console.log(`\nSession data saved to:\n${sessionDir}`);
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});
