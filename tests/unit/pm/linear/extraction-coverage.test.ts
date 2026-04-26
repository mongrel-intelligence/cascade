/**
 * Regression net for spec 016/3 AC#7.
 *
 * Loads the captured/reconstructed Linear Issue GraphQL fixture and asserts
 * our extraction picks up every inline image in it. Fails LOUDLY if Linear
 * ever changes its payload shape in a way that loses inline images.
 *
 * Also pins the rule that `Issue.attachments` records (link previews from
 * Slack/GitHub/Sentry) are NOT mistaken for inline images.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractMarkdownImages } from '../../../../src/pm/media.js';

interface FixtureIssue {
	id: string;
	identifier: string;
	description: string;
	attachments: {
		nodes: Array<{ id: string; title: string; url: string }>;
	};
	comments: {
		nodes: Array<{ id: string; body: string }>;
	};
}

interface Fixture {
	issue: FixtureIssue;
}

function loadFixture(): FixtureIssue {
	const fixturePath = join(
		__dirname,
		'..',
		'..',
		'..',
		'fixtures',
		'linear-issue-with-screenshot.json',
	);
	const raw = readFileSync(fixturePath, 'utf-8');
	const fixture = JSON.parse(raw) as Fixture;
	return fixture.issue;
}

// The exact set of URLs that the fixture's description embeds via markdown
// image syntax. This is the regression-truth that Plan 1's extraction must
// always be able to recover from the fixture description string.
const EXPECTED_DESCRIPTION_IMAGE_URLS = [
	'https://uploads.linear.app/abc-123-def-456-extension-less-uuid',
	'https://uploads.linear.app/xyz-789-with-alt-text/Mockup.png',
	'https://example.com/logo.svg',
];

const EXPECTED_COMMENT_IMAGE_URLS = ['https://uploads.linear.app/comment-screenshot-uuid'];

describe('Linear extraction-coverage regression', () => {
	it('description: extracts every inline image from the fixture description', () => {
		const issue = loadFixture();
		const refs = extractMarkdownImages(issue.description);
		const urls = refs.map((r) => r.url);

		// Every expected URL must be present.
		for (const expectedUrl of EXPECTED_DESCRIPTION_IMAGE_URLS) {
			expect(
				urls,
				`Linear description image MISSED: ${expectedUrl} — Linear payload may have changed shape; update fixture or extraction.`,
			).toContain(expectedUrl);
		}
		expect(refs).toHaveLength(EXPECTED_DESCRIPTION_IMAGE_URLS.length);
	});

	it('description: assigns image/* sentinel to extension-less Linear URLs', () => {
		const issue = loadFixture();
		const refs = extractMarkdownImages(issue.description);
		const linearExtensionless = refs.find(
			(r) => r.url === 'https://uploads.linear.app/abc-123-def-456-extension-less-uuid',
		);
		expect(linearExtensionless?.mimeType).toBe('image/*');
	});

	it('description: assigns concrete MIME for extensioned Linear URL', () => {
		const issue = loadFixture();
		const refs = extractMarkdownImages(issue.description);
		const mockup = refs.find(
			(r) => r.url === 'https://uploads.linear.app/xyz-789-with-alt-text/Mockup.png',
		);
		expect(mockup?.mimeType).toBe('image/png');
		expect(mockup?.altText).toBe('Annotated mockup');
	});

	it('description: external SVG URL extracted with image/svg+xml MIME', () => {
		const issue = loadFixture();
		const refs = extractMarkdownImages(issue.description);
		const svg = refs.find((r) => r.url === 'https://example.com/logo.svg');
		expect(svg?.mimeType).toBe('image/svg+xml');
	});

	it('description: non-image markdown links are NOT extracted', () => {
		const issue = loadFixture();
		const refs = extractMarkdownImages(issue.description);
		// "[See related ticket](...)" is a regular markdown link, not an image.
		expect(refs.find((r) => r.url.includes('MNG-100'))).toBeUndefined();
	});

	it('comments: extracts inline images from each comment body', () => {
		const issue = loadFixture();
		const allCommentRefs: string[] = [];
		for (const comment of issue.comments.nodes) {
			const refs = extractMarkdownImages(comment.body, 'comment');
			allCommentRefs.push(...refs.map((r) => r.url));
		}

		for (const expectedUrl of EXPECTED_COMMENT_IMAGE_URLS) {
			expect(allCommentRefs, `Linear comment image MISSED: ${expectedUrl}`).toContain(expectedUrl);
		}
		expect(allCommentRefs).toHaveLength(EXPECTED_COMMENT_IMAGE_URLS.length);
	});

	it('comments: source field marks them as comment-origin', () => {
		const issue = loadFixture();
		const refs = extractMarkdownImages(issue.comments.nodes[0].body, 'comment');
		expect(refs[0].source).toBe('comment');
	});

	it('attachments: formal Attachment records (Slack/GitHub/Sentry link previews) are NOT mistaken for inline images', () => {
		const issue = loadFixture();
		// The Linear adapter's getAttachments returns these. They have URLs but
		// they're link previews, not inline images. Our inline-image extraction
		// only reads the description and comment bodies — never the attachments
		// connection. This test pins that contract by asserting that none of
		// the attachment URLs appear in the description-extracted set.
		const descRefs = extractMarkdownImages(issue.description);
		const descUrls = new Set(descRefs.map((r) => r.url));
		for (const att of issue.attachments.nodes) {
			expect(
				descUrls.has(att.url),
				`Linear attachment leaked into description extraction: ${att.url}`,
			).toBe(false);
		}
	});

	it('regression net: meta-test confirms the test mechanism works (assertion fires when fixture is wrong)', () => {
		// Sanity: prove that .toContain() actually fails when an expected URL
		// is missing. If the fixture were stripped of all images, this test's
		// guarantee (the spec AC#7 "fails loudly" promise) would still hold —
		// the meta-check confirms the negative case.
		const refs = extractMarkdownImages('No images here, just text.');
		const urls = refs.map((r) => r.url);
		expect(() => {
			for (const expectedUrl of EXPECTED_DESCRIPTION_IMAGE_URLS) {
				expect(urls).toContain(expectedUrl);
			}
		}).toThrow();
	});
});
