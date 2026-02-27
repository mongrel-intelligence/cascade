/**
 * Twilio webhook handler — receives inbound SMS messages.
 *
 * URL: POST /twilio/webhook/:projectId
 *
 * Validates the Twilio signature, logs the incoming message,
 * and returns empty TwiML. No agent is triggered yet — that will
 * be wired up when a dedicated sms-responder agent is written.
 */

import type { Context } from 'hono';
import twilio from 'twilio';
import { getIntegrationCredentialOrNull } from '../../config/provider.js';
import { logger } from '../../utils/logging.js';

function getPublicUrl(c: Context): string {
	const parsed = new URL(c.req.url);
	const proto = c.req.header('X-Forwarded-Proto') ?? parsed.protocol.replace(':', '');
	const host = c.req.header('X-Forwarded-Host') ?? c.req.header('Host') ?? parsed.host;
	const path = parsed.pathname + parsed.search;
	return `${proto}://${host}${path}`;
}

export async function handleTwilioWebhook(c: Context): Promise<Response> {
	const projectId = c.req.param('projectId');

	// Parse URL-encoded POST body from Twilio
	const body = await c.req.parseBody();

	const signature = c.req.header('X-Twilio-Signature') ?? '';
	const url = getPublicUrl(c);

	// Resolve auth_token for signature validation
	const authToken = await getIntegrationCredentialOrNull(projectId, 'sms', 'auth_token');
	if (!authToken) {
		logger.warn('[TwilioWebhook] No auth_token configured for project', { projectId });
		return c.text('Forbidden', 403);
	}

	// Filter out File entries — validateRequest only accepts string values
	const stringBody = Object.fromEntries(
		Object.entries(body).filter((kv): kv is [string, string] => typeof kv[1] === 'string'),
	);

	// Validate Twilio signature
	const isValid = twilio.validateRequest(authToken, signature, url, stringBody);
	if (!isValid) {
		logger.warn('[TwilioWebhook] Invalid signature', { projectId });
		return c.text('Forbidden', 403);
	}

	logger.info('[TwilioWebhook] Incoming SMS', {
		projectId,
		messageSid: stringBody.MessageSid,
		from: stringBody.From,
		to: stringBody.To,
		body: stringBody.Body,
	});

	// Future: check integration triggers.agentType and submit a dashboard job

	c.header('Content-Type', 'text/xml');
	return c.text('<?xml version="1.0" encoding="UTF-8"?><Response/>', 200);
}
