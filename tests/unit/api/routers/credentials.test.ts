import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';

const mockListOrgCredentials = vi.fn();
const mockCreateCredential = vi.fn();
const mockUpdateCredential = vi.fn();
const mockDeleteCredential = vi.fn();

vi.mock('../../../../src/db/repositories/credentialsRepository.js', () => ({
	listOrgCredentials: (...args: unknown[]) => mockListOrgCredentials(...args),
	createCredential: (...args: unknown[]) => mockCreateCredential(...args),
	updateCredential: (...args: unknown[]) => mockUpdateCredential(...args),
	deleteCredential: (...args: unknown[]) => mockDeleteCredential(...args),
}));

const mockDecryptCredential = vi.fn((value: string) => value);

vi.mock('../../../../src/db/crypto.js', () => ({
	decryptCredential: (...args: unknown[]) => mockDecryptCredential(...args),
}));

// Mock getDb for ownership checks
const mockDbSelect = vi.fn();
const mockDbFrom = vi.fn();
const mockDbWhere = vi.fn();

vi.mock('../../../../src/db/client.js', () => ({
	getDb: () => ({
		select: mockDbSelect,
	}),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
	credentials: { id: 'id', orgId: 'org_id', value: 'value' },
}));

const mockGetAuthenticated = vi.fn();
vi.mock('@octokit/rest', () => ({
	Octokit: vi.fn().mockImplementation(() => ({
		users: { getAuthenticated: mockGetAuthenticated },
	})),
}));

import { Octokit } from '@octokit/rest';

import { credentialsRouter } from '../../../../src/api/routers/credentials.js';

function createCaller(ctx: TRPCContext) {
	return credentialsRouter.createCaller(ctx);
}

const mockUser = {
	id: 'user-1',
	orgId: 'org-1',
	email: 'test@example.com',
	name: 'Test',
	role: 'admin',
};

describe('credentialsRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbSelect.mockReturnValue({ from: mockDbFrom });
		mockDbFrom.mockReturnValue({ where: mockDbWhere });
	});

	describe('list', () => {
		it('returns credentials with masked values', async () => {
			mockListOrgCredentials.mockResolvedValue([
				{
					id: 1,
					name: 'Token',
					envVarKey: 'GITHUB_TOKEN',
					value: 'ghp_abc123def456',
					isDefault: true,
				},
				{ id: 2, name: 'Key', envVarKey: 'API_KEY', value: 'sk', isDefault: false },
			]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.list();

			expect(mockListOrgCredentials).toHaveBeenCalledWith('org-1');
			expect(result).toHaveLength(2);
			expect(result[0].value).toBe('****f456');
			expect(result[1].value).toBe('****');
		});

		it('returns empty array when no credentials', async () => {
			mockListOrgCredentials.mockResolvedValue([]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.list();
			expect(result).toEqual([]);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	describe('create', () => {
		it('creates credential with all fields', async () => {
			mockCreateCredential.mockResolvedValue({ id: 42 });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.create({
				name: 'GitHub Bot',
				envVarKey: 'GITHUB_TOKEN',
				value: 'ghp_test123',
				isDefault: true,
			});

			expect(mockCreateCredential).toHaveBeenCalledWith({
				orgId: 'org-1',
				name: 'GitHub Bot',
				envVarKey: 'GITHUB_TOKEN',
				value: 'ghp_test123',
				isDefault: true,
			});
			expect(result).toEqual({ id: 42 });
		});

		it('rejects invalid env var key format', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(
				caller.create({ name: 'X', envVarKey: 'invalid-key', value: 'v' }),
			).rejects.toThrow();
		});

		it('rejects env var key starting with number', async () => {
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.create({ name: 'X', envVarKey: '123KEY', value: 'v' })).rejects.toThrow();
		});

		it('accepts underscore-prefixed env var key', async () => {
			mockCreateCredential.mockResolvedValue({ id: 1 });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.create({ name: 'X', envVarKey: '_MY_KEY', value: 'v' });
			expect(mockCreateCredential).toHaveBeenCalled();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(
				caller.create({ name: 'X', envVarKey: 'KEY', value: 'v' }),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});
	});

	describe('update', () => {
		it('updates credential after verifying ownership', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockUpdateCredential.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.update({ id: 42, name: 'Updated Name', value: 'new-secret' });

			expect(mockUpdateCredential).toHaveBeenCalledWith(42, {
				name: 'Updated Name',
				value: 'new-secret',
			});
		});

		it('throws NOT_FOUND when credential belongs to different org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.update({ id: 42, name: 'X' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
			expect(mockUpdateCredential).not.toHaveBeenCalled();
		});

		it('throws NOT_FOUND when credential does not exist', async () => {
			mockDbWhere.mockResolvedValue([]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.update({ id: 999, name: 'X' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});
	});

	describe('delete', () => {
		it('deletes credential after verifying ownership', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1' }]);
			mockDeleteCredential.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.delete({ id: 42 });

			expect(mockDeleteCredential).toHaveBeenCalledWith(42);
		});

		it('throws NOT_FOUND when credential belongs to different org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org' }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.delete({ id: 42 })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
			expect(mockDeleteCredential).not.toHaveBeenCalled();
		});

		it('throws NOT_FOUND when credential does not exist', async () => {
			mockDbWhere.mockResolvedValue([]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.delete({ id: 999 })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.delete({ id: 42 })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});

	describe('verifyGithubIdentity', () => {
		it('decrypts credential before calling GitHub API', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1', value: 'enc:v1:encrypted-token' }]);
			mockDecryptCredential.mockReturnValue('ghp_decrypted_token');
			mockGetAuthenticated.mockResolvedValue({
				data: { login: 'cascade-bot', avatar_url: 'https://example.com/avatar.png' },
			});

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			const result = await caller.verifyGithubIdentity({ credentialId: 42 });

			expect(mockDecryptCredential).toHaveBeenCalledWith('enc:v1:encrypted-token', 'org-1');
			expect(Octokit).toHaveBeenCalledWith({ auth: 'ghp_decrypted_token' });
			expect(result).toEqual({
				login: 'cascade-bot',
				avatarUrl: 'https://example.com/avatar.png',
			});
		});

		it('throws NOT_FOUND when credential belongs to different org', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'different-org', value: 'token' }]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.verifyGithubIdentity({ credentialId: 42 })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws BAD_REQUEST when GitHub API fails', async () => {
			mockDbWhere.mockResolvedValue([{ orgId: 'org-1', value: 'bad-token' }]);
			mockDecryptCredential.mockReturnValue('bad-token');
			mockGetAuthenticated.mockRejectedValue(new Error('Bad credentials'));

			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });
			await expect(caller.verifyGithubIdentity({ credentialId: 42 })).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
		});
	});
});
