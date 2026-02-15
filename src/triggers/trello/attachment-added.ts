import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { getTrelloCredentials, trelloClient } from '../../trello/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TrelloWebhookPayload } from '../types.js';
import { isTrelloWebhookPayload } from '../types.js';

// Cache authenticated user ID to avoid repeated API calls
let cachedMemberId: string | null = null;

async function getAuthenticatedMemberId(): Promise<string> {
	if (cachedMemberId) {
		return cachedMemberId;
	}
	const me = await trelloClient.getMe();
	cachedMemberId = me.id;
	logger.info('Cached authenticated member ID', { memberId: cachedMemberId });
	return cachedMemberId;
}

/**
 * Pattern for agent session log files: {agent-type}-{timestamp}.zip
 * Examples:
 * - implementation-2026-01-02T12-34-56-789Z.zip
 * - briefing-timeout-2026-01-02T12-34-56-789Z.zip
 */
function parseAgentLogFilename(filename: string): { agentType: string } | null {
	// Match pattern: {agent-type}-{timestamp}.zip
	// Allow optional "timeout-" after agent type
	const match = filename.match(/^([a-z]+)(?:-timeout)?-[\d-TZ]+\.zip$/i);
	if (!match) {
		return null;
	}
	return {
		agentType: match[1].toLowerCase(),
	};
}

async function downloadAndExtractZip(url: string, destDir: string): Promise<void> {
	logger.debug('Downloading zip attachment', { url, destDir });

	// Download with Trello OAuth headers (from scoped credentials)
	const { apiKey, token } = getTrelloCredentials();
	const response = await fetch(url, {
		headers: {
			Authorization: `OAuth oauth_consumer_key="${apiKey}", oauth_token="${token}"`,
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to download attachment: ${response.status}`);
	}

	// Download to buffer
	const buffer = Buffer.from(await response.arrayBuffer());

	// Extract ZIP
	const zip = new AdmZip(buffer);
	zip.extractAllTo(destDir, true);

	logger.info('Extracted zip attachment', { destDir, fileCount: zip.getEntries().length });
}

export class AttachmentAddedTrigger implements TriggerHandler {
	name = 'attachment-added-to-card';
	description = 'Triggers debug agent when agent session log zip is uploaded';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'trello') return false;
		if (!isTrelloWebhookPayload(ctx.payload)) return false;

		const payload = ctx.payload;

		// Check if it's an attachment action
		if (payload.action.type !== 'addAttachmentToCard') {
			return false;
		}

		// Check if attachment exists and is a .zip file
		const attachment = payload.action.data.attachment;
		if (!attachment || !attachment.name.endsWith('.zip')) {
			return false;
		}

		// Check if filename matches agent log pattern
		const parsed = parseAgentLogFilename(attachment.name);
		if (!parsed) {
			logger.debug('Attachment does not match agent log pattern', {
				filename: attachment.name,
			});
			return false;
		}

		// Don't trigger debug agent for debug agent's own logs (prevent infinite loop)
		if (parsed.agentType === 'debug') {
			logger.debug('Skipping debug agent log to prevent infinite loop', {
				filename: attachment.name,
			});
			return false;
		}

		// Check if DEBUG list is configured
		const debugListId = ctx.project.trello.lists.debug;
		if (!debugListId) {
			logger.warn('DEBUG list not configured, skipping debug agent trigger', {
				projectId: ctx.project.id,
			});
			return false;
		}

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as TrelloWebhookPayload;
		const cardId = payload.action.data.card?.id;
		const cardName = payload.action.data.card?.name;
		const attachment = payload.action.data.attachment;

		if (!cardId || !cardName || !attachment) {
			throw new Error('Missing card or attachment data in payload');
		}

		// Verify uploader is the authenticated user
		const authenticatedMemberId = await getAuthenticatedMemberId();
		if (payload.action.idMemberCreator !== authenticatedMemberId) {
			logger.info('Attachment uploaded by different user, skipping', {
				uploaderId: payload.action.idMemberCreator,
				authenticatedId: authenticatedMemberId,
			});
			return null;
		}

		// Parse agent type from filename
		const parsed = parseAgentLogFilename(attachment.name);
		if (!parsed) {
			// This shouldn't happen since matches() already checked, but be safe
			return null;
		}

		logger.info('Processing agent log attachment', {
			cardId,
			cardName,
			filename: attachment.name,
			agentType: parsed.agentType,
		});

		// Create temp directory for extracted logs
		const timestamp = Date.now();
		const logDir = join(tmpdir(), `debug-${cardId}-${timestamp}`);

		try {
			// Download and extract the zip
			await downloadAndExtractZip(attachment.url, logDir);

			// Get original card URL
			const card = await trelloClient.getCard(cardId);

			return {
				agentType: 'debug',
				agentInput: {
					logDir,
					originalCardId: cardId,
					originalCardName: cardName,
					originalCardUrl: card.shortUrl,
					detectedAgentType: parsed.agentType,
				},
				cardId, // For potential log attachment back to original card
			};
		} catch (err) {
			logger.error('Failed to download/extract attachment', {
				error: String(err),
				cardId,
				attachmentName: attachment.name,
			});
			throw err;
		}
	}
}
