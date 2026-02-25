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
	PMDeleteChecklistItem: mockClass('PMDeleteChecklistItem'),
	PMUpdateChecklistItem: mockClass('PMUpdateChecklistItem'),
	PostComment: mockClass('PostComment'),
	ReadWorkItem: mockClass('ReadWorkItem'),
	UpdateWorkItem: mockClass('UpdateWorkItem'),
}));
vi.mock('../../../../src/gadgets/tmux.js', () => ({ Tmux: mockClass('Tmux') }));
vi.mock('../../../../src/gadgets/todo/index.js', () => ({
	TodoUpsert: mockClass('TodoUpsert'),
	TodoUpdateStatus: mockClass('TodoUpdateStatus'),
	TodoDelete: mockClass('TodoDelete'),
}));

import type { AgentCapabilities } from '../../../../src/agents/shared/capabilities.js';
import {
	buildPRAgentGadgets,
	buildReviewGadgets,
	buildWorkItemGadgets,
} from '../../../../src/agents/shared/gadgets.js';

function names(gadgets: unknown[]): string[] {
	return gadgets.map((g) => (g as object).constructor.name);
}

const FULL_CAPS: AgentCapabilities = {
	canEditFiles: true,
	canCreatePR: true,
	canUpdateChecklists: true,
	isReadOnly: false,
};

const READ_ONLY_CAPS: AgentCapabilities = {
	canEditFiles: false,
	canCreatePR: false,
	canUpdateChecklists: false,
	isReadOnly: true,
};

describe('buildWorkItemGadgets', () => {
	it('always includes base read gadgets and session control', () => {
		const gadgets = names(buildWorkItemGadgets(FULL_CAPS));
		expect(gadgets).toContain('ListDirectory');
		expect(gadgets).toContain('ReadFile');
		expect(gadgets).toContain('RipGrep');
		expect(gadgets).toContain('AstGrep');
		expect(gadgets).toContain('Tmux');
		expect(gadgets).toContain('Sleep');
		expect(gadgets).toContain('TodoUpsert');
		expect(gadgets).toContain('TodoUpdateStatus');
		expect(gadgets).toContain('TodoDelete');
		expect(gadgets).toContain('ReadWorkItem');
		expect(gadgets).toContain('PostComment');
		expect(gadgets).toContain('Finish');
	});

	it('includes file-editing gadgets when canEditFiles is true', () => {
		const gadgets = names(buildWorkItemGadgets(FULL_CAPS));
		expect(gadgets).toContain('FileSearchAndReplace');
		expect(gadgets).toContain('FileMultiEdit');
		expect(gadgets).toContain('WriteFile');
		expect(gadgets).toContain('VerifyChanges');
	});

	it('excludes file-editing gadgets when canEditFiles is false', () => {
		const gadgets = names(buildWorkItemGadgets(READ_ONLY_CAPS));
		expect(gadgets).not.toContain('FileSearchAndReplace');
		expect(gadgets).not.toContain('FileMultiEdit');
		expect(gadgets).not.toContain('WriteFile');
		expect(gadgets).not.toContain('VerifyChanges');
	});

	it('includes CreatePR when canCreatePR is true', () => {
		const gadgets = names(buildWorkItemGadgets(FULL_CAPS));
		expect(gadgets).toContain('CreatePR');
	});

	it('excludes CreatePR when canCreatePR is false', () => {
		const gadgets = names(buildWorkItemGadgets(READ_ONLY_CAPS));
		expect(gadgets).not.toContain('CreatePR');
	});

	it('includes PMUpdateChecklistItem and PMDeleteChecklistItem when canUpdateChecklists is true', () => {
		const gadgets = names(buildWorkItemGadgets(FULL_CAPS));
		expect(gadgets).toContain('PMUpdateChecklistItem');
		expect(gadgets).toContain('PMDeleteChecklistItem');
	});

	it('excludes PMUpdateChecklistItem and PMDeleteChecklistItem when canUpdateChecklists is false', () => {
		const gadgets = names(buildWorkItemGadgets(READ_ONLY_CAPS));
		expect(gadgets).not.toContain('PMUpdateChecklistItem');
		expect(gadgets).not.toContain('PMDeleteChecklistItem');
	});
});

describe('buildReviewGadgets', () => {
	it('includes PR review gadgets', () => {
		const gadgets = names(buildReviewGadgets());
		expect(gadgets).toContain('GetPRDetails');
		expect(gadgets).toContain('GetPRDiff');
		expect(gadgets).toContain('GetPRChecks');
		expect(gadgets).toContain('CreatePRReview');
		expect(gadgets).toContain('UpdatePRComment');
		expect(gadgets).toContain('Finish');
	});

	it('does not include file-editing gadgets (read-only)', () => {
		const gadgets = names(buildReviewGadgets());
		expect(gadgets).not.toContain('FileSearchAndReplace');
		expect(gadgets).not.toContain('WriteFile');
		expect(gadgets).not.toContain('CreatePR');
	});

	it('does not include PostPRComment (submits via CreatePRReview)', () => {
		const gadgets = names(buildReviewGadgets());
		expect(gadgets).not.toContain('PostPRComment');
	});
});

describe('buildPRAgentGadgets', () => {
	it('includes file editing and GitHub PR tools', () => {
		const gadgets = names(buildPRAgentGadgets());
		expect(gadgets).toContain('FileSearchAndReplace');
		expect(gadgets).toContain('FileMultiEdit');
		expect(gadgets).toContain('WriteFile');
		expect(gadgets).toContain('VerifyChanges');
		expect(gadgets).toContain('GetPRDetails');
		expect(gadgets).toContain('GetPRDiff');
		expect(gadgets).toContain('GetPRChecks');
		expect(gadgets).toContain('PostPRComment');
		expect(gadgets).toContain('Finish');
	});

	it('does not include CreatePR (pushes to existing branch)', () => {
		const gadgets = names(buildPRAgentGadgets());
		expect(gadgets).not.toContain('CreatePR');
	});

	it('excludes review comment tools by default', () => {
		const gadgets = names(buildPRAgentGadgets());
		expect(gadgets).not.toContain('GetPRComments');
		expect(gadgets).not.toContain('ReplyToReviewComment');
	});

	it('includes review comment tools when includeReviewComments is true', () => {
		const gadgets = names(buildPRAgentGadgets({ includeReviewComments: true }));
		expect(gadgets).toContain('GetPRComments');
		expect(gadgets).toContain('ReplyToReviewComment');
	});
});
