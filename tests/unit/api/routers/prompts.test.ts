import { describe, expect, it, vi } from 'vitest';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

// Mock prompt functions
const {
	mockGetValidAgentTypes,
	mockGetRawTemplate,
	mockGetTemplateVariables,
	mockValidateTemplate,
	mockGetAvailablePartialNames,
	mockGetRawPartial,
	mockLoadPartials,
	mockListPartials,
	mockGetPartial,
	mockUpsertPartial,
	mockDeletePartial,
} = vi.hoisted(() => ({
	mockGetValidAgentTypes: vi.fn(),
	mockGetRawTemplate: vi.fn(),
	mockGetTemplateVariables: vi.fn(),
	mockValidateTemplate: vi.fn(),
	mockGetAvailablePartialNames: vi.fn(),
	mockGetRawPartial: vi.fn(),
	mockLoadPartials: vi.fn(),
	mockListPartials: vi.fn(),
	mockGetPartial: vi.fn(),
	mockUpsertPartial: vi.fn(),
	mockDeletePartial: vi.fn(),
}));

vi.mock('../../../../src/agents/prompts/index.js', () => ({
	getValidAgentTypes: mockGetValidAgentTypes,
	getRawTemplate: mockGetRawTemplate,
	getTemplateVariables: mockGetTemplateVariables,
	validateTemplate: mockValidateTemplate,
	getAvailablePartialNames: mockGetAvailablePartialNames,
	getRawPartial: mockGetRawPartial,
}));

// Mock partials repository
vi.mock('../../../../src/db/repositories/partialsRepository.js', () => ({
	loadPartials: mockLoadPartials,
	listPartials: mockListPartials,
	getPartial: mockGetPartial,
	upsertPartial: mockUpsertPartial,
	deletePartial: mockDeletePartial,
}));

import { promptsRouter } from '../../../../src/api/routers/prompts.js';

const createCaller = createCallerFor(promptsRouter);

const mockUser = createMockSuperAdmin();
const mockAdminUser = createMockUser({ role: 'admin' });

describe('promptsRouter', () => {
	describe('agentTypes', () => {
		it('returns list of agent types', async () => {
			const types = ['splitting', 'planning', 'implementation'];
			mockGetValidAgentTypes.mockReturnValue(types);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.agentTypes();

			expect(result).toEqual(types);
			expect(mockGetValidAgentTypes).toHaveBeenCalled();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.agentTypes(), 'UNAUTHORIZED');
		});
	});

	describe('getDefault', () => {
		it('returns raw template for valid agent type', async () => {
			mockGetRawTemplate.mockReturnValue('Template content: <%= it.baseBranch %>');
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.getDefault({ agentType: 'splitting' });

			expect(result).toEqual({ content: 'Template content: <%= it.baseBranch %>' });
			expect(mockGetRawTemplate).toHaveBeenCalledWith('splitting');
		});

		it('throws NOT_FOUND for unknown agent type', async () => {
			mockGetRawTemplate.mockImplementation(() => {
				throw new Error('Unknown');
			});
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.getDefault({ agentType: 'unknown' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.getDefault({ agentType: 'splitting' }), 'UNAUTHORIZED');
		});
	});

	describe('variables', () => {
		it('returns template variables', async () => {
			const vars = [{ name: 'baseBranch', group: 'Common', description: 'Base branch' }];
			mockGetTemplateVariables.mockReturnValue(vars);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.variables();

			expect(result).toEqual(vars);
		});
	});

	describe('validate', () => {
		it('returns valid for correct template', async () => {
			mockLoadPartials.mockResolvedValue(new Map());
			mockValidateTemplate.mockReturnValue({ valid: true });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.validate({ template: 'Hello <%= it.name %>' });

			expect(result).toEqual({ valid: true });
			expect(mockLoadPartials).toHaveBeenCalled();
		});

		it('returns invalid with error for bad template', async () => {
			mockLoadPartials.mockResolvedValue(new Map());
			mockValidateTemplate.mockReturnValue({ valid: false, error: 'Syntax error' });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.validate({ template: '<% broken' });

			expect(result).toEqual({ valid: false, error: 'Syntax error' });
		});
	});

	describe('listPartials', () => {
		it('merges DB and disk partials', async () => {
			mockListPartials.mockResolvedValue([
				{ id: 1, name: 'git', content: 'DB git\ncontent', orgId: null },
			]);
			mockGetAvailablePartialNames.mockReturnValue(['git', 'tmux']);
			mockGetRawPartial.mockImplementation((name: string) => {
				if (name === 'tmux') return 'Tmux content\nline 2\nline 3';
				throw new Error('Not found');
			});
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.listPartials();

			expect(result).toEqual([
				{ name: 'git', source: 'db', lines: 2, id: 1 },
				{ name: 'tmux', source: 'disk', lines: 3 },
			]);
		});

		it('includes DB-only partials not on disk', async () => {
			mockListPartials.mockResolvedValue([
				{ id: 5, name: 'custom-partial', content: 'Custom\ncontent', orgId: null },
			]);
			mockGetAvailablePartialNames.mockReturnValue([]);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.listPartials();

			expect(result).toEqual([{ name: 'custom-partial', source: 'db', lines: 2, id: 5 }]);
		});
	});

	describe('getPartial', () => {
		it('returns DB partial when available', async () => {
			mockGetPartial.mockResolvedValue({ id: 1, name: 'git', content: 'DB content' });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.getPartial({ name: 'git' });

			expect(result).toEqual({ name: 'git', content: 'DB content', source: 'db', id: 1 });
		});

		it('falls back to disk when no DB partial', async () => {
			mockGetPartial.mockResolvedValue(null);
			mockGetRawPartial.mockReturnValue('Disk content');
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.getPartial({ name: 'git' });

			expect(result).toEqual({ name: 'git', content: 'Disk content', source: 'disk' });
		});

		it('throws NOT_FOUND when partial not in DB or disk', async () => {
			mockGetPartial.mockResolvedValue(null);
			mockGetRawPartial.mockImplementation(() => {
				throw new Error('Not found');
			});
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.getPartial({ name: 'nonexistent' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});
	});

	describe('getDefaultPartial', () => {
		it('returns disk partial content', async () => {
			mockGetRawPartial.mockReturnValue('Default content');
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.getDefaultPartial({ name: 'git' });

			expect(result).toEqual({ content: 'Default content' });
		});

		it('throws NOT_FOUND when no disk partial', async () => {
			mockGetRawPartial.mockImplementation(() => {
				throw new Error('Not found');
			});
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(caller.getDefaultPartial({ name: 'nonexistent' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});
	});

	describe('upsertPartial', () => {
		it('upserts valid partial content', async () => {
			mockLoadPartials.mockResolvedValue(new Map());
			mockValidateTemplate.mockReturnValue({ valid: true });
			mockUpsertPartial.mockResolvedValue({
				id: 1,
				name: 'git',
				content: 'New content',
				orgId: null,
			});
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.upsertPartial({ name: 'git', content: 'New content' });

			expect(result).toMatchObject({ name: 'git', content: 'New content' });
			expect(mockUpsertPartial).toHaveBeenCalledWith({ name: 'git', content: 'New content' });
		});

		it('rejects invalid partial content', async () => {
			mockLoadPartials.mockResolvedValue(new Map());
			mockValidateTemplate.mockReturnValue({ valid: false, error: 'Bad syntax' });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await expect(
				caller.upsertPartial({ name: 'git', content: '<% broken' }),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		});

		it('throws FORBIDDEN for admin role (not superadmin)', async () => {
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });
			await expectTRPCError(caller.upsertPartial({ name: 'git', content: 'content' }), 'FORBIDDEN');
		});
	});

	describe('deletePartial', () => {
		it('deletes a partial by id', async () => {
			mockDeletePartial.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			await caller.deletePartial({ id: 1 });

			expect(mockDeletePartial).toHaveBeenCalledWith(1);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.deletePartial({ id: 1 }), 'UNAUTHORIZED');
		});

		it('throws FORBIDDEN for admin role (not superadmin)', async () => {
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });
			await expectTRPCError(caller.deletePartial({ id: 1 }), 'FORBIDDEN');
		});
	});
});
