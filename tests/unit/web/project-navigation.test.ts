import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PROJECT_SECTION,
	PROJECT_SECTIONS,
	isProjectActive,
	isSectionActive,
	resolveDefaultProjectPath,
} from '../../../web/src/lib/project-sections.js';

describe('PROJECT_SECTIONS', () => {
	it('contains exactly the expected sections in order', () => {
		expect(PROJECT_SECTIONS.map((s) => s.id)).toEqual([
			'general',
			'harness',
			'work',
			'stats',
			'integrations',
			'agent-configs',
			'lifecycle',
		]);
	});

	it('each section has a non-empty label and path', () => {
		for (const section of PROJECT_SECTIONS) {
			expect(section.label.length).toBeGreaterThan(0);
			expect(section.path.length).toBeGreaterThan(0);
		}
	});

	it('has unique ids', () => {
		const ids = PROJECT_SECTIONS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('has unique paths', () => {
		const paths = PROJECT_SECTIONS.map((s) => s.path);
		expect(new Set(paths).size).toBe(paths.length);
	});
});

describe('DEFAULT_PROJECT_SECTION', () => {
	it('is "general"', () => {
		expect(DEFAULT_PROJECT_SECTION).toBe('general');
	});

	it('exists in PROJECT_SECTIONS', () => {
		const ids = PROJECT_SECTIONS.map((s) => s.id);
		expect(ids).toContain(DEFAULT_PROJECT_SECTION);
	});
});

describe('section path mapping', () => {
	it('maps general section to /general path', () => {
		const generalSection = PROJECT_SECTIONS.find((s) => s.id === 'general');
		expect(generalSection?.path).toBe('general');
	});

	it('harness section has label "Engine" and path "harness" (URL stability)', () => {
		const harnessSection = PROJECT_SECTIONS.find((s) => s.id === 'harness');
		expect(harnessSection?.label).toBe('Engine');
		expect(harnessSection?.path).toBe('harness');
	});

	it('maps agent-configs section to /agent-configs path', () => {
		const agentConfigsSection = PROJECT_SECTIONS.find((s) => s.id === 'agent-configs');
		expect(agentConfigsSection?.path).toBe('agent-configs');
	});

	it('maps work section to /work path', () => {
		const workSection = PROJECT_SECTIONS.find((s) => s.id === 'work');
		expect(workSection?.path).toBe('work');
	});

	it('maps integrations section to /integrations path', () => {
		const integrationsSection = PROJECT_SECTIONS.find((s) => s.id === 'integrations');
		expect(integrationsSection?.path).toBe('integrations');
	});

	it('maps stats section to /stats path', () => {
		const statsSection = PROJECT_SECTIONS.find((s) => s.id === 'stats');
		expect(statsSection?.path).toBe('stats');
	});
});

describe('isProjectActive', () => {
	it('detects active project from section path', () => {
		expect(isProjectActive('/projects/my-project/general', 'my-project')).toBe(true);
		expect(isProjectActive('/projects/my-project/work', 'my-project')).toBe(true);
		expect(isProjectActive('/projects/my-project/agent-configs', 'my-project')).toBe(true);
	});

	it('detects active project at root path', () => {
		expect(isProjectActive('/projects/my-project', 'my-project')).toBe(true);
	});

	it('does not falsely match other projects', () => {
		expect(isProjectActive('/projects/other-project/general', 'my-project')).toBe(false);
		expect(isProjectActive('/projects', 'my-project')).toBe(false);
	});
});

describe('isSectionActive', () => {
	it('returns true for matching section path', () => {
		expect(isSectionActive('/projects/proj1/general', 'proj1', 'general')).toBe(true);
		expect(isSectionActive('/projects/proj1/work', 'proj1', 'work')).toBe(true);
		expect(isSectionActive('/projects/proj1/agent-configs', 'proj1', 'agent-configs')).toBe(true);
	});

	it('returns false for non-matching section', () => {
		expect(isSectionActive('/projects/proj1/general', 'proj1', 'work')).toBe(false);
		expect(isSectionActive('/projects/proj1/integrations', 'proj1', 'general')).toBe(false);
	});

	it('returns false for different project', () => {
		expect(isSectionActive('/projects/proj2/general', 'proj1', 'general')).toBe(false);
	});

	it('returns true for sub-paths of a section', () => {
		expect(isSectionActive('/projects/proj1/work/details', 'proj1', 'work')).toBe(true);
	});
});

describe('resolveDefaultProjectPath', () => {
	it('resolves to /general for any project id', () => {
		expect(resolveDefaultProjectPath('abc123')).toBe('/projects/abc123/general');
		expect(resolveDefaultProjectPath('my-project')).toBe('/projects/my-project/general');
	});

	it('always uses the DEFAULT_PROJECT_SECTION', () => {
		const projectId = 'test-proj';
		expect(resolveDefaultProjectPath(projectId)).toBe(
			`/projects/${projectId}/${DEFAULT_PROJECT_SECTION}`,
		);
	});
});
