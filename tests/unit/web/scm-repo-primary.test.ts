/**
 * Spec 024 plan 5 — the repository-role control on the SCM tab.
 *
 * A repository may be shared by several projects, exactly one of which is the
 * PRIMARY: the one that receives events for PRs CASCADE did not create. Plan 4
 * enforces that at save time; this is the operator's way to say which they are.
 *
 * The payload shape is the part worth pinning, so it lives in a pure builder
 * the component calls rather than being asserted through a DOM render.
 */
import { describe, expect, it } from 'vitest';
import { buildScmSavePayload } from '../../../web/src/components/projects/scm-save-payload.js';

describe('SCM save payload — repository role', () => {
	const base = { projectId: 'p1', repo: 'acme/web', baseBranch: 'main', branchPrefix: 'feature/' };

	it('omits the role when the operator has not touched it', () => {
		// AC #12 pin. Backend-side, an update that does not mention the role
		// preserves it — so sending nothing is how an unrelated save (a base
		// branch edit, say) leaves a shared repository's topology alone.
		expect(buildScmSavePayload({ ...base, repoPrimary: undefined })).not.toHaveProperty(
			'repoPrimary',
		);
	});

	it('sends false when the operator chooses secondary', () => {
		expect(buildScmSavePayload({ ...base, repoPrimary: false })).toMatchObject({
			repoPrimary: false,
		});
	});

	it('sends true when the operator chooses primary', () => {
		expect(buildScmSavePayload({ ...base, repoPrimary: true })).toMatchObject({
			repoPrimary: true,
		});
	});

	it('carries the repository alongside the role', () => {
		// The backend rejects a role without a repository, because a role that
		// describes no repository would be written nowhere and still report
		// success. The two must travel together.
		const payload = buildScmSavePayload({ ...base, repoPrimary: false });
		expect(payload.repo).toBe('acme/web');
	});

	it('sends no repository at all when the field is empty', () => {
		// PM-only projects: `repo: ''` must become undefined, not an empty string
		// the backend would try to claim.
		const payload = buildScmSavePayload({ ...base, repo: '', repoPrimary: undefined });
		expect(payload.repo).toBeUndefined();
	});

	it('never sends a role for a project with no repository', () => {
		// Guards the backend's "role requires a repo" rejection from being
		// reachable through the UI at all.
		const payload = buildScmSavePayload({ ...base, repo: '', repoPrimary: true });
		expect(payload).not.toHaveProperty('repoPrimary');
	});
});
