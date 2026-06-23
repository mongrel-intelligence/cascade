/**
 * Regression guard for the GitHub Webhook Signing Secret field (MNG-1657).
 *
 * `GitHubWebhookSection` is a hook-heavy JSX component (uses `useQuery`,
 * `useMutation`, `useQueryClient`, and `ProjectSecretField` which pulls
 * React from `web/node_modules`). It cannot be rendered as a plain function
 * outside a React rendering context, and the unit environment has no jsdom.
 * This test reads the source directly — the same source-read pattern used by
 * `combobox.test.ts` and `pm-wizard-styling-guard.test.ts`.
 *
 * The backend already supports `GITHUB_WEBHOOK_SECRET` (the `webhook_secret`
 * role on the GitHub SCM integration drives `verifyGitHubWebhookSignature`).
 * This story is the UI-only field to set it; these assertions pin that field's
 * wiring.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCM_TAB_PATH = resolve(REPO_ROOT, 'web/src/components/projects/integration-scm-tab.tsx');

const source = readFileSync(SCM_TAB_PATH, 'utf8');

/** Region of the file spanning the GitHubWebhookSection component body. */
function webhookSectionRegion(): string {
	const start = source.indexOf('function GitHubWebhookSection(');
	const end = source.indexOf('export function SCMTab');
	expect(start, 'GitHubWebhookSection function must exist').toBeGreaterThan(-1);
	expect(end, 'SCMTab function must exist').toBeGreaterThan(start);
	return source.slice(start, end);
}

/**
 * Isolate the `<ProjectSecretField .../>` element bound to the webhook secret.
 * Splitting on the tag keeps us from accidentally matching the implementer /
 * reviewer fields in GitHubCredentialSlots (which DO declare onVerify).
 */
function webhookSecretFieldElement(): string {
	const segment = source
		.split('<ProjectSecretField')
		.find((s) => s.includes('envVarKey="GITHUB_WEBHOOK_SECRET"'));
	if (!segment) {
		throw new Error('a ProjectSecretField bound to GITHUB_WEBHOOK_SECRET must exist');
	}
	const closeIdx = segment.indexOf('/>');
	expect(closeIdx, 'the field element must be self-closing').toBeGreaterThan(-1);
	return segment.slice(0, closeIdx);
}

describe('SCM tab — GitHub Webhook Signing Secret field', () => {
	it('renders a ProjectSecretField bound to envVarKey="GITHUB_WEBHOOK_SECRET" inside GitHubWebhookSection', () => {
		const region = webhookSectionRegion();
		expect(region).toContain('<ProjectSecretField');
		expect(region).toContain('envVarKey="GITHUB_WEBHOOK_SECRET"');
	});

	it('places the field above the curl details and the Create webhook button', () => {
		const fieldIdx = source.indexOf('envVarKey="GITHUB_WEBHOOK_SECRET"');
		const curlDetailsIdx = source.indexOf('Manual webhook creation');
		const createButtonIdx = source.indexOf('Create GitHub Webhook');
		expect(fieldIdx).toBeGreaterThan(-1);
		expect(curlDetailsIdx).toBeGreaterThan(-1);
		expect(createButtonIdx).toBeGreaterThan(-1);
		expect(fieldIdx, 'field must render above the curl <details>').toBeLessThan(curlDetailsIdx);
		expect(fieldIdx, 'field must render above the Create button').toBeLessThan(createButtonIdx);
	});

	it('queries existing credentials via trpc.projects.credentials.list and passes the matching credential', () => {
		const region = webhookSectionRegion();
		expect(region).toContain('trpc.projects.credentials.list.queryOptions({ projectId })');
		expect(region).toContain("c.envVarKey === 'GITHUB_WEBHOOK_SECRET'");
		// The derived credential is forwarded so the configured badge + masked
		// last-4 render when the secret is set.
		expect(webhookSecretFieldElement()).toContain('credential={webhookSecretCred}');
	});

	it('uses the label "Webhook Signing Secret (optional)"', () => {
		expect(webhookSecretFieldElement()).toContain('label="Webhook Signing Secret (optional)"');
	});

	it('describes HMAC-SHA256 verification, skip-when-blank, and side-symmetry', () => {
		const field = webhookSecretFieldElement();
		expect(field).toMatch(/description="[^"]*HMAC-SHA256[^"]*"/);
		expect(field, 'must explain verification is skipped when blank').toMatch(
			/description="[^"]*skipped[^"]*"/,
		);
		expect(field, 'must explain the same value goes on the GitHub side').toMatch(
			/description="[^"]*same value[^"]*GitHub[^"]*"/,
		);
	});

	it('does NOT render a verify button (onVerify omitted)', () => {
		// The signing secret has no remote identity to resolve. Omitting onVerify
		// means ProjectSecretField renders only Save/Clear (no Verify button),
		// while still self-managing persistence + credentials.list invalidation.
		expect(webhookSecretFieldElement()).not.toContain('onVerify');
	});
});
