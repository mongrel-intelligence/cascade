import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptCredential } from '../../../src/db/crypto.js';
import type { CredentialRow } from '../../../tools/migrate-project-credentials-reencrypt.js';
import { processRows } from '../../../tools/migrate-project-credentials-reencrypt.js';

const TEST_KEY = randomBytes(32).toString('hex');

// Minimal no-op update function for tests that don't need to assert on it
const noopUpdate = vi.fn().mockResolvedValue(undefined);

describe('migrate-project-credentials-reencrypt', () => {
	beforeEach(() => {
		vi.stubEnv('CREDENTIAL_MASTER_KEY', TEST_KEY);
	});

	describe('processRows', () => {
		describe('plaintext rows', () => {
			it('skips plaintext values and counts them', async () => {
				const rows: CredentialRow[] = [
					{ id: 1, projectId: 'proj-1', orgId: 'org-1', value: 'ghp_plaintext' },
				];

				const result = await processRows(rows, { dryRun: false, updateFn: noopUpdate });

				expect(result).toEqual({ reencrypted: 0, alreadyCorrect: 0, plaintext: 1, failed: 0 });
				expect(noopUpdate).not.toHaveBeenCalled();
			});
		});

		describe('already-correct rows (encrypted with projectId AAD)', () => {
			it('skips rows already encrypted with projectId and counts them', async () => {
				const value = encryptCredential('secret', 'proj-1');
				const rows: CredentialRow[] = [{ id: 1, projectId: 'proj-1', orgId: 'org-1', value }];

				const result = await processRows(rows, { dryRun: false, updateFn: noopUpdate });

				expect(result).toEqual({ reencrypted: 0, alreadyCorrect: 1, plaintext: 0, failed: 0 });
				expect(noopUpdate).not.toHaveBeenCalled();
			});
		});

		describe('legacy rows (encrypted with orgId AAD)', () => {
			it('re-encrypts rows encrypted with orgId AAD', async () => {
				const value = encryptCredential('secret', 'org-1'); // orgId as AAD (legacy)
				const rows: CredentialRow[] = [{ id: 1, projectId: 'proj-1', orgId: 'org-1', value }];

				const updateFn = vi.fn().mockResolvedValue(undefined);
				const result = await processRows(rows, { dryRun: false, updateFn });

				expect(result).toEqual({ reencrypted: 1, alreadyCorrect: 0, plaintext: 0, failed: 0 });
				expect(updateFn).toHaveBeenCalledOnce();

				// Verify the new value is correctly decryptable with projectId
				const [newId, newValue] = updateFn.mock.calls[0] as [number, string];
				expect(newId).toBe(1);
				const { decryptCredential } = await import('../../../src/db/crypto.js');
				expect(decryptCredential(newValue, 'proj-1')).toBe('secret');
			});

			it('does not call updateFn in dry-run mode', async () => {
				const value = encryptCredential('secret', 'org-1');
				const rows: CredentialRow[] = [{ id: 1, projectId: 'proj-1', orgId: 'org-1', value }];

				const updateFn = vi.fn();
				const result = await processRows(rows, { dryRun: true, updateFn });

				expect(result).toEqual({ reencrypted: 1, alreadyCorrect: 0, plaintext: 0, failed: 0 });
				expect(updateFn).not.toHaveBeenCalled();
			});
		});

		describe('unresolvable rows', () => {
			it('counts rows that cannot be decrypted with either AAD as failed', async () => {
				// Encrypted with a third, unknown AAD
				const value = encryptCredential('secret', 'some-other-aad');
				const rows: CredentialRow[] = [{ id: 1, projectId: 'proj-1', orgId: 'org-1', value }];

				const result = await processRows(rows, { dryRun: false, updateFn: noopUpdate });

				expect(result).toEqual({ reencrypted: 0, alreadyCorrect: 0, plaintext: 0, failed: 1 });
				expect(noopUpdate).not.toHaveBeenCalled();
			});

			it('continues processing remaining rows after a failure', async () => {
				const badValue = encryptCredential('secret', 'unknown-aad');
				const goodValue = encryptCredential('other', 'org-1'); // legacy orgId row
				const rows: CredentialRow[] = [
					{ id: 1, projectId: 'proj-1', orgId: 'org-1', value: badValue },
					{ id: 2, projectId: 'proj-1', orgId: 'org-1', value: goodValue },
				];

				const updateFn = vi.fn().mockResolvedValue(undefined);
				const result = await processRows(rows, { dryRun: false, updateFn });

				expect(result).toEqual({ reencrypted: 1, alreadyCorrect: 0, plaintext: 0, failed: 1 });
				expect(updateFn).toHaveBeenCalledOnce();
			});
		});

		describe('mixed batch', () => {
			it('correctly classifies a mixed set of rows', async () => {
				const plaintextRow: CredentialRow = {
					id: 1,
					projectId: 'proj-1',
					orgId: 'org-1',
					value: 'ghp_plaintext',
				};
				const alreadyCorrectRow: CredentialRow = {
					id: 2,
					projectId: 'proj-1',
					orgId: 'org-1',
					value: encryptCredential('correct', 'proj-1'),
				};
				const legacyRow: CredentialRow = {
					id: 3,
					projectId: 'proj-1',
					orgId: 'org-1',
					value: encryptCredential('legacy', 'org-1'),
				};
				const failedRow: CredentialRow = {
					id: 4,
					projectId: 'proj-1',
					orgId: 'org-1',
					value: encryptCredential('bad', 'wrong-aad'),
				};

				const updateFn = vi.fn().mockResolvedValue(undefined);
				const result = await processRows([plaintextRow, alreadyCorrectRow, legacyRow, failedRow], {
					dryRun: false,
					updateFn,
				});

				expect(result).toEqual({ reencrypted: 1, alreadyCorrect: 1, plaintext: 1, failed: 1 });
				expect(updateFn).toHaveBeenCalledOnce();
				expect(updateFn.mock.calls[0]?.[0]).toBe(3); // only the legacy row was updated
			});
		});

		describe('empty batch', () => {
			it('returns all-zero counts for an empty batch', async () => {
				const result = await processRows([], { dryRun: false, updateFn: noopUpdate });

				expect(result).toEqual({ reencrypted: 0, alreadyCorrect: 0, plaintext: 0, failed: 0 });
			});
		});

		describe('multiple projects / different orgIds', () => {
			it('handles rows from different projects with different orgIds', async () => {
				const rows: CredentialRow[] = [
					{
						id: 1,
						projectId: 'proj-a',
						orgId: 'org-a',
						value: encryptCredential('token-a', 'org-a'), // legacy
					},
					{
						id: 2,
						projectId: 'proj-b',
						orgId: 'org-b',
						value: encryptCredential('token-b', 'org-b'), // legacy
					},
				];

				const updateFn = vi.fn().mockResolvedValue(undefined);
				const result = await processRows(rows, { dryRun: false, updateFn });

				expect(result).toEqual({ reencrypted: 2, alreadyCorrect: 0, plaintext: 0, failed: 0 });
				expect(updateFn).toHaveBeenCalledTimes(2);

				// Verify each re-encrypted value is correct for its project
				const { decryptCredential } = await import('../../../src/db/crypto.js');
				const [[id1, val1], [id2, val2]] = updateFn.mock.calls as [number, string][];
				expect(id1).toBe(1);
				expect(decryptCredential(val1, 'proj-a')).toBe('token-a');
				expect(id2).toBe(2);
				expect(decryptCredential(val2, 'proj-b')).toBe('token-b');
			});
		});
	});
});
