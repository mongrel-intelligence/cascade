import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Create a mock class with the given name so constructor.name works in assertions */
function mockClass(name: string) {
	const cls = { [name]: class {} }[name];
	return vi.fn().mockImplementation(() => new cls());
}

vi.mock('../../../../src/gadgets/AstGrep.js', () => ({ AstGrep: mockClass('AstGrep') }));
vi.mock('../../../../src/gadgets/FileMultiEdit.js', () => ({
	FileMultiEdit: mockClass('FileMultiEdit'),
}));
vi.mock('../../../../src/gadgets/FileSearchAndReplace.js', () => ({
	FileSearchAndReplace: mockClass('FileSearchAndReplace'),
}));
vi.mock('../../../../src/gadgets/Finish.js', () => ({ Finish: mockClass('Finish') }));
vi.mock('../../../../src/gadgets/ListDirectory.js', () => ({
	ListDirectory: mockClass('ListDirectory'),
}));
vi.mock('../../../../src/gadgets/ReadFile.js', () => ({ ReadFile: mockClass('ReadFile') }));
vi.mock('../../../../src/gadgets/RipGrep.js', () => ({ RipGrep: mockClass('RipGrep') }));
vi.mock('../../../../src/gadgets/Sleep.js', () => ({ Sleep: mockClass('Sleep') }));
vi.mock('../../../../src/gadgets/VerifyChanges.js', () => ({
	VerifyChanges: mockClass('VerifyChanges'),
}));
vi.mock('../../../../src/gadgets/WriteFile.js', () => ({ WriteFile: mockClass('WriteFile') }));
vi.mock('../../../../src/gadgets/github/index.js', () => ({
	CreatePR: mockClass('CreatePR'),
	CreatePRReview: mockClass('CreatePRReview'),
	GetCIRunLogs: mockClass('GetCIRunLogs'),
	GetPRChecks: mockClass('GetPRChecks'),
	GetPRComments: mockClass('GetPRComments'),
	GetPRDetails: mockClass('GetPRDetails'),
	GetPRDiff: mockClass('GetPRDiff'),
	PostPRComment: mockClass('PostPRComment'),
	ReplyToReviewComment: mockClass('ReplyToReviewComment'),
	UpdatePRComment: mockClass('UpdatePRComment'),
}));
vi.mock('../../../../src/gadgets/pm/index.js', () => ({
	AddChecklist: mockClass('AddChecklist'),
	CreateWorkItem: mockClass('CreateWorkItem'),
	ListWorkItems: mockClass('ListWorkItems'),
	MoveWorkItem: mockClass('MoveWorkItem'),
	PMDeleteChecklistItem: mockClass('PMDeleteChecklistItem'),
	PMUpdateChecklistItem: mockClass('PMUpdateChecklistItem'),
	PostComment: mockClass('PostComment'),
	ReadWorkItem: mockClass('ReadWorkItem'),
	UpdateWorkItem: mockClass('UpdateWorkItem'),
}));
vi.mock('../../../../src/gadgets/email/index.js', () => ({
	SendEmail: mockClass('SendEmail'),
	SearchEmails: mockClass('SearchEmails'),
	ReadEmail: mockClass('ReadEmail'),
	ReplyToEmail: mockClass('ReplyToEmail'),
	MarkEmailAsSeen: mockClass('MarkEmailAsSeen'),
}));
vi.mock('../../../../src/gadgets/tmux.js', () => ({ Tmux: mockClass('Tmux') }));
vi.mock('../../../../src/gadgets/todo/index.js', () => ({
	TodoUpsert: mockClass('TodoUpsert'),
	TodoUpdateStatus: mockClass('TodoUpdateStatus'),
	TodoDelete: mockClass('TodoDelete'),
}));

import type { Capability } from '../../../../src/agents/capabilities/index.js';
import { buildGadgetsFromCapabilities } from '../../../../src/agents/capabilities/resolver.js';
import { buildGadgetsForAgent } from '../../../../src/agents/shared/gadgets.js';

function names(gadgets: unknown[]): string[] {
	return gadgets.map((g) => (g as object).constructor.name);
}

describe('buildGadgetsFromCapabilities', () => {
	describe('fs:read capability', () => {
		it('includes filesystem read gadgets', () => {
			const caps: Capability[] = ['fs:read'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('ListDirectory');
			expect(gadgets).toContain('ReadFile');
			expect(gadgets).toContain('RipGrep');
			expect(gadgets).toContain('AstGrep');
		});
	});

	describe('fs:write capability', () => {
		it('includes filesystem write gadgets', () => {
			const caps: Capability[] = ['fs:write'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('WriteFile');
			expect(gadgets).toContain('FileSearchAndReplace');
			expect(gadgets).toContain('FileMultiEdit');
			expect(gadgets).toContain('VerifyChanges');
		});
	});

	describe('shell:exec capability', () => {
		it('includes shell execution gadgets', () => {
			const caps: Capability[] = ['shell:exec'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('Tmux');
			expect(gadgets).toContain('Sleep');
		});
	});

	describe('session:ctrl capability', () => {
		it('includes session control gadgets', () => {
			const caps: Capability[] = ['session:ctrl'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('Finish');
			expect(gadgets).toContain('TodoUpsert');
			expect(gadgets).toContain('TodoUpdateStatus');
			expect(gadgets).toContain('TodoDelete');
		});
	});

	describe('pm capabilities', () => {
		it('pm:read includes read work item gadgets', () => {
			const caps: Capability[] = ['pm:read'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('ReadWorkItem');
			expect(gadgets).toContain('ListWorkItems');
		});

		it('pm:write includes write work item gadgets', () => {
			const caps: Capability[] = ['pm:write'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('UpdateWorkItem');
			expect(gadgets).toContain('CreateWorkItem');
			expect(gadgets).toContain('PostComment');
			expect(gadgets).toContain('AddChecklist');
		});

		it('pm:checklist includes checklist gadgets', () => {
			const caps: Capability[] = ['pm:checklist'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('PMUpdateChecklistItem');
			expect(gadgets).toContain('PMDeleteChecklistItem');
		});
	});

	describe('scm capabilities', () => {
		it('scm:read includes PR read gadgets', () => {
			const caps: Capability[] = ['scm:read'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('GetPRDetails');
			expect(gadgets).toContain('GetPRDiff');
			expect(gadgets).toContain('GetPRChecks');
		});

		it('scm:comment includes PR comment gadgets', () => {
			const caps: Capability[] = ['scm:comment'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('PostPRComment');
			expect(gadgets).toContain('UpdatePRComment');
			expect(gadgets).toContain('GetPRComments');
			expect(gadgets).toContain('ReplyToReviewComment');
		});

		it('scm:review includes PR review gadgets', () => {
			const caps: Capability[] = ['scm:review'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('CreatePRReview');
		});

		it('scm:pr includes CreatePR gadget', () => {
			const caps: Capability[] = ['scm:pr'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('CreatePR');
		});
	});

	describe('email capabilities', () => {
		it('email:read includes email read gadgets', () => {
			const caps: Capability[] = ['email:read'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('SearchEmails');
			expect(gadgets).toContain('ReadEmail');
			expect(gadgets).toContain('MarkEmailAsSeen');
		});

		it('email:write includes email write gadgets', () => {
			const caps: Capability[] = ['email:write'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			expect(gadgets).toContain('SendEmail');
			expect(gadgets).toContain('ReplyToEmail');
		});
	});

	describe('combined capabilities', () => {
		it('implementation-like capabilities include all expected gadgets', () => {
			const caps: Capability[] = [
				'fs:read',
				'fs:write',
				'shell:exec',
				'session:ctrl',
				'pm:read',
				'pm:write',
				'pm:checklist',
				'scm:pr',
			];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			// Filesystem
			expect(gadgets).toContain('ListDirectory');
			expect(gadgets).toContain('ReadFile');
			expect(gadgets).toContain('WriteFile');
			// Shell
			expect(gadgets).toContain('Tmux');
			// PM
			expect(gadgets).toContain('ReadWorkItem');
			expect(gadgets).toContain('PMUpdateChecklistItem');
			// SCM
			expect(gadgets).toContain('CreatePR');
			// Session
			expect(gadgets).toContain('Finish');
		});

		it('review-like capabilities exclude file editing and PR creation', () => {
			const caps: Capability[] = [
				'fs:read',
				'shell:exec',
				'session:ctrl',
				'scm:read',
				'scm:review',
			];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			// Should have
			expect(gadgets).toContain('ReadFile');
			expect(gadgets).toContain('CreatePRReview');
			// Should NOT have
			expect(gadgets).not.toContain('WriteFile');
			expect(gadgets).not.toContain('CreatePR');
		});

		it('does not create duplicate gadgets when capabilities overlap', () => {
			const caps: Capability[] = ['fs:read', 'fs:read', 'session:ctrl'];
			const gadgets = names(buildGadgetsFromCapabilities(caps));
			// ListDirectory should appear only once
			const listDirCount = gadgets.filter((n) => n === 'ListDirectory').length;
			expect(listDirCount).toBe(1);
		});
	});
});

describe('buildGadgetsForAgent', () => {
	it('uses capabilities to build gadgets', () => {
		const caps: Capability[] = ['fs:read', 'session:ctrl'];
		const gadgets = names(buildGadgetsForAgent(caps));
		expect(gadgets).toContain('ReadFile');
		expect(gadgets).toContain('Finish');
	});

	it('adds review comment gadgets when includeReviewComments option is set and scm:comment not in capabilities', () => {
		// Without scm:comment capability, but with includeReviewComments option
		const caps: Capability[] = ['fs:read', 'session:ctrl'];
		const gadgets = names(buildGadgetsForAgent(caps, { includeReviewComments: true }));
		expect(gadgets).toContain('GetPRComments');
		expect(gadgets).toContain('ReplyToReviewComment');
	});

	it('does not duplicate review comment gadgets when scm:comment capability is present', () => {
		// With scm:comment capability AND includeReviewComments option
		const caps: Capability[] = ['fs:read', 'session:ctrl', 'scm:comment'];
		const gadgets = names(buildGadgetsForAgent(caps, { includeReviewComments: true }));
		// Count GetPRComments - should be exactly 1
		const count = gadgets.filter((n) => n === 'GetPRComments').length;
		expect(count).toBe(1);
	});
});
