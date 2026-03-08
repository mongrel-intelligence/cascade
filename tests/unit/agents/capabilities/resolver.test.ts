import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Create a mock class with the given name so constructor.name works in assertions */
function mockClass(name: string) {
	const cls = { [name]: class {} }[name];
	return vi.fn().mockImplementation(() => new cls());
}

// Mock all gadget imports
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
vi.mock('../../../../src/gadgets/sms/index.js', () => ({
	SendSms: mockClass('SendSms'),
}));
vi.mock('../../../../src/gadgets/tmux.js', () => ({ Tmux: mockClass('Tmux') }));
vi.mock('../../../../src/gadgets/todo/index.js', () => ({
	TodoUpsert: mockClass('TodoUpsert'),
	TodoUpdateStatus: mockClass('TodoUpdateStatus'),
	TodoDelete: mockClass('TodoDelete'),
}));

import type { Capability } from '../../../../src/agents/capabilities/index.js';
import {
	deriveIntegrations,
	deriveRequiredIntegrations,
	filterToolManifests,
	generateUnavailableCapabilitiesNote,
	getGadgetNamesFromCapabilities,
	getSdkToolsFromCapabilities,
	getUnavailableOptionalCapabilities,
	resolveEffectiveCapabilities,
} from '../../../../src/agents/capabilities/resolver.js';
import type { ToolManifest } from '../../../../src/agents/contracts/index.js';
import type { IntegrationCategory } from '../../../../src/agents/definitions/schema.js';

describe('deriveRequiredIntegrations', () => {
	it('returns empty array for built-in capabilities only', () => {
		const caps: Capability[] = ['fs:read', 'fs:write', 'shell:exec', 'session:ctrl'];
		expect(deriveRequiredIntegrations(caps)).toEqual([]);
	});

	it('returns pm for pm:read capability', () => {
		const caps: Capability[] = ['pm:read'];
		expect(deriveRequiredIntegrations(caps)).toEqual(['pm']);
	});

	it('returns scm for scm:pr capability', () => {
		const caps: Capability[] = ['scm:pr'];
		expect(deriveRequiredIntegrations(caps)).toEqual(['scm']);
	});

	it('returns unique integrations even with multiple capabilities from same integration', () => {
		const caps: Capability[] = ['pm:read', 'pm:write', 'pm:checklist'];
		const result = deriveRequiredIntegrations(caps);
		expect(result).toEqual(['pm']);
	});

	it('returns all unique integrations from mixed capabilities', () => {
		const caps: Capability[] = ['fs:read', 'pm:read', 'scm:pr', 'email:read'];
		const result = deriveRequiredIntegrations(caps);
		expect(result).toContain('pm');
		expect(result).toContain('scm');
		expect(result).toContain('email');
		expect(result).toHaveLength(3);
	});
});

describe('deriveIntegrations', () => {
	it('separates required and optional integrations', () => {
		const required: Capability[] = ['fs:read', 'scm:pr'];
		const optional: Capability[] = ['pm:read', 'pm:write'];
		const result = deriveIntegrations(required, optional);
		expect(result.required).toEqual(['scm']);
		expect(result.optional).toEqual(['pm']);
	});

	it('does not include integration in optional if already in required', () => {
		const required: Capability[] = ['pm:read', 'scm:pr'];
		const optional: Capability[] = ['pm:write']; // pm already required
		const result = deriveIntegrations(required, optional);
		expect(result.required).toContain('pm');
		expect(result.required).toContain('scm');
		expect(result.optional).toEqual([]);
	});
});

describe('resolveEffectiveCapabilities', () => {
	it('always includes all required capabilities', () => {
		const required: Capability[] = ['fs:read', 'scm:pr'];
		const optional: Capability[] = [];
		const hasIntegration = () => false; // No integrations available
		const result = resolveEffectiveCapabilities(required, optional, hasIntegration);
		expect(result).toContain('fs:read');
		expect(result).toContain('scm:pr');
	});

	it('includes optional built-in capabilities regardless of integration availability', () => {
		const required: Capability[] = ['fs:read'];
		const optional: Capability[] = ['fs:write', 'shell:exec'];
		const hasIntegration = () => false;
		const result = resolveEffectiveCapabilities(required, optional, hasIntegration);
		expect(result).toContain('fs:write');
		expect(result).toContain('shell:exec');
	});

	it('includes optional capabilities when their integration is available', () => {
		const required: Capability[] = ['fs:read', 'scm:pr'];
		const optional: Capability[] = ['pm:read', 'pm:write'];
		const hasIntegration = (cat: IntegrationCategory) => cat === 'pm';
		const result = resolveEffectiveCapabilities(required, optional, hasIntegration);
		expect(result).toContain('pm:read');
		expect(result).toContain('pm:write');
	});

	it('excludes optional capabilities when their integration is not available', () => {
		const required: Capability[] = ['fs:read', 'scm:pr'];
		const optional: Capability[] = ['pm:read', 'pm:write'];
		const hasIntegration = () => false;
		const result = resolveEffectiveCapabilities(required, optional, hasIntegration);
		expect(result).not.toContain('pm:read');
		expect(result).not.toContain('pm:write');
	});

	it('handles mixed availability of optional integrations', () => {
		const required: Capability[] = ['fs:read'];
		const optional: Capability[] = ['pm:read', 'email:read', 'sms:send'];
		const hasIntegration = (cat: IntegrationCategory) => cat === 'pm' || cat === 'sms';
		const result = resolveEffectiveCapabilities(required, optional, hasIntegration);
		expect(result).toContain('pm:read');
		expect(result).toContain('sms:send');
		expect(result).not.toContain('email:read');
	});
});

describe('getUnavailableOptionalCapabilities', () => {
	it('returns empty array when all optional are built-in', () => {
		const optional: Capability[] = ['fs:write', 'shell:exec'];
		const hasIntegration = () => false;
		expect(getUnavailableOptionalCapabilities(optional, hasIntegration)).toEqual([]);
	});

	it('returns unavailable integration-based capabilities', () => {
		const optional: Capability[] = ['pm:read', 'pm:write', 'email:read'];
		const hasIntegration = (cat: IntegrationCategory) => cat === 'pm';
		const result = getUnavailableOptionalCapabilities(optional, hasIntegration);
		expect(result).toEqual(['email:read']);
	});

	it('returns all integration-based capabilities when no integrations available', () => {
		const optional: Capability[] = ['pm:read', 'scm:comment'];
		const hasIntegration = () => false;
		const result = getUnavailableOptionalCapabilities(optional, hasIntegration);
		expect(result).toContain('pm:read');
		expect(result).toContain('scm:comment');
	});
});

describe('generateUnavailableCapabilitiesNote', () => {
	it('returns null for empty array', () => {
		expect(generateUnavailableCapabilitiesNote([])).toBeNull();
	});

	it('generates note for unavailable PM capabilities', () => {
		const unavailable: Capability[] = ['pm:read', 'pm:write'];
		const note = generateUnavailableCapabilitiesNote(unavailable);
		expect(note).toContain('PM integration');
		expect(note).toContain('not configured');
		expect(note).toContain('ReadWorkItem');
	});

	it('generates note for multiple unavailable integrations', () => {
		const unavailable: Capability[] = ['pm:read', 'email:write'];
		const note = generateUnavailableCapabilitiesNote(unavailable);
		expect(note).toContain('PM integration');
		expect(note).toContain('Email integration');
	});
});

describe('getGadgetNamesFromCapabilities', () => {
	it('returns gadget names for capabilities', () => {
		const caps: Capability[] = ['fs:read'];
		const names = getGadgetNamesFromCapabilities(caps);
		expect(names).toContain('ReadFile');
		expect(names).toContain('ListDirectory');
		expect(names).toContain('RipGrep');
		expect(names).toContain('AstGrep');
	});

	it('returns unique names even when capabilities share gadgets', () => {
		const caps: Capability[] = ['fs:read', 'fs:read'];
		const names = getGadgetNamesFromCapabilities(caps);
		const readFileCount = names.filter((n) => n === 'ReadFile').length;
		expect(readFileCount).toBe(1);
	});
});

describe('getSdkToolsFromCapabilities', () => {
	it('returns SDK tools for fs:read', () => {
		const caps: Capability[] = ['fs:read'];
		const tools = getSdkToolsFromCapabilities(caps);
		expect(tools).toContain('Read');
		expect(tools).toContain('Glob');
		expect(tools).toContain('Grep');
	});

	it('returns SDK tools for fs:write', () => {
		const caps: Capability[] = ['fs:write'];
		const tools = getSdkToolsFromCapabilities(caps);
		expect(tools).toContain('Write');
		expect(tools).toContain('Edit');
	});

	it('returns Bash for shell:exec', () => {
		const caps: Capability[] = ['shell:exec'];
		const tools = getSdkToolsFromCapabilities(caps);
		expect(tools).toContain('Bash');
	});
});

describe('filterToolManifests', () => {
	it('filters manifests to only those matching capability gadgets', () => {
		const manifests: ToolManifest[] = [
			{ name: 'ReadFile', description: 'Read a file', inputSchema: {} },
			{ name: 'WriteFile', description: 'Write a file', inputSchema: {} },
			{ name: 'CreatePR', description: 'Create PR', inputSchema: {} },
		];
		const caps: Capability[] = ['fs:read'];
		const filtered = filterToolManifests(manifests, caps);
		expect(filtered).toHaveLength(1);
		expect(filtered[0].name).toBe('ReadFile');
	});

	it('includes all gadgets for multiple capabilities', () => {
		const manifests: ToolManifest[] = [
			{ name: 'ReadFile', description: 'Read', inputSchema: {} },
			{ name: 'WriteFile', description: 'Write', inputSchema: {} },
			{ name: 'CreatePR', description: 'PR', inputSchema: {} },
		];
		const caps: Capability[] = ['fs:read', 'fs:write'];
		const filtered = filterToolManifests(manifests, caps);
		expect(filtered).toHaveLength(2);
		expect(filtered.map((m) => m.name)).toContain('ReadFile');
		expect(filtered.map((m) => m.name)).toContain('WriteFile');
	});

	it('logs warning for missing expected tools', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const manifests: ToolManifest[] = [
			{ name: 'ReadFile', description: 'Read', inputSchema: {} },
			// Missing ListDirectory, RipGrep, AstGrep
		];
		const caps: Capability[] = ['fs:read'];
		filterToolManifests(manifests, caps);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('Expected tools not found in manifests'),
		);
		warnSpy.mockRestore();
	});
});
