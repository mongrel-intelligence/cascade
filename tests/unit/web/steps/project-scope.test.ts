/**
 * Tests for the shared ProjectScopeStep (plan 010/3 task 1).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StandardStep } from '../../../../src/integrations/pm/manifest.js';
import { ProjectScopeStep } from '../../../../web/src/components/projects/pm-providers/steps/project-scope.js';

const step: StandardStep = { kind: 'project-scope', id: 'scope' };

describe('ProjectScopeStep', () => {
	it('renders "No project scope" as the first option', () => {
		const html = renderToStaticMarkup(
			createElement(ProjectScopeStep, {
				step,
				providerId: 'linear',
				projects: [
					{ id: 'p1', name: 'Project One' },
					{ id: 'p2', name: 'Project Two' },
				],
				selectedProjectId: null,
				onSelect: () => {},
			}),
		);
		expect(html).toContain('No project scope');
		expect(html).toContain('Project One');
		expect(html).toContain('Project Two');
	});

	it('preselects the current project when supplied', () => {
		const html = renderToStaticMarkup(
			createElement(ProjectScopeStep, {
				step,
				providerId: 'linear',
				projects: [
					{ id: 'p1', name: 'Project One' },
					{ id: 'p2', name: 'Project Two' },
				],
				selectedProjectId: 'p2',
				onSelect: () => {},
			}),
		);
		expect(html).toMatch(/<option[^>]*value="p2"[^>]*selected/);
	});

	it('renders loading and error states', () => {
		const loading = renderToStaticMarkup(
			createElement(ProjectScopeStep, {
				step,
				providerId: 'linear',
				projects: [],
				selectedProjectId: null,
				onSelect: () => {},
				loading: true,
			}),
		);
		expect(loading).toContain('data-state="loading"');

		const error = renderToStaticMarkup(
			createElement(ProjectScopeStep, {
				step,
				providerId: 'linear',
				projects: [],
				selectedProjectId: null,
				onSelect: () => {},
				error: 'failed',
			}),
		);
		expect(error).toContain('data-state="error"');
	});

	it('exposes the select action identifier', () => {
		const html = renderToStaticMarkup(
			createElement(ProjectScopeStep, {
				step,
				providerId: 'linear',
				projects: [],
				selectedProjectId: null,
				onSelect: () => {},
			}),
		);
		expect(html).toContain('data-action="select-project-scope"');
	});
});
