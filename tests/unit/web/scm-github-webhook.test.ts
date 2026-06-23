/**
 * Tests for `buildGithubWebhookCurl` (MNG-1658).
 *
 * The manual webhook `curl` command was hoisted out of `GitHubWebhookSection`
 * into an exported pure helper so it can be unit-tested without React Query /
 * tRPC providers. These assertions pin the curl payload shape: the signing
 * secret placeholder, the callback URL interpolation, and the full event list.
 *
 * Follows the string-assertion conventions in `linear-webhook-step.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { buildGithubWebhookCurl } from '../../../web/src/components/projects/integration-scm-tab.js';

const CALLBACK_URL = 'https://router.example.com/github/webhook';

describe('buildGithubWebhookCurl', () => {
	it('includes a "secret" field in the config object', () => {
		const curl = buildGithubWebhookCurl(CALLBACK_URL);
		expect(curl).toContain('"secret"');
	});

	it('uses the <YOUR_WEBHOOK_SECRET> placeholder, never a real secret value', () => {
		const curl = buildGithubWebhookCurl(CALLBACK_URL);
		expect(curl).toContain('"secret": "<YOUR_WEBHOOK_SECRET>"');
	});

	it('interpolates the provided callback URL into the config.url field', () => {
		const curl = buildGithubWebhookCurl(CALLBACK_URL);
		expect(curl).toContain(`"url": "${CALLBACK_URL}"`);
	});

	it('renders the full GitHub event list', () => {
		const curl = buildGithubWebhookCurl(CALLBACK_URL);
		for (const event of [
			'push',
			'pull_request',
			'pull_request_review',
			'pull_request_review_comment',
			'check_suite',
			'issue_comment',
		]) {
			expect(curl).toContain(event);
		}
	});

	it('targets the GitHub repo hooks API with content_type json', () => {
		const curl = buildGithubWebhookCurl(CALLBACK_URL);
		expect(curl).toContain('curl -X POST "https://api.github.com/repos/<OWNER>/<REPO>/hooks"');
		expect(curl).toContain('"content_type": "json"');
	});

	it('produces a config object whose JSON body parses with url, content_type and secret', () => {
		const curl = buildGithubWebhookCurl(CALLBACK_URL);
		// Extract the JSON payload passed to `-d '{ ... }'` and parse it to prove
		// adding the secret field kept the body valid JSON (no trailing-comma break).
		const jsonStart = curl.indexOf('{');
		const jsonEnd = curl.lastIndexOf('}');
		const payload = JSON.parse(curl.slice(jsonStart, jsonEnd + 1));
		expect(payload.config).toMatchObject({
			url: CALLBACK_URL,
			content_type: 'json',
			secret: '<YOUR_WEBHOOK_SECRET>',
		});
		expect(payload.events).toContain('check_suite');
	});

	it('reflects different callback URLs (pure function, no hidden state)', () => {
		const other = 'https://other.example.com/github/webhook';
		expect(buildGithubWebhookCurl(other)).toContain(`"url": "${other}"`);
	});
});
