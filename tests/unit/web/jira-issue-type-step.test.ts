/**
 * Tests for the JIRA-specific IssueTypeMappingStep (plan 011/3 task 2).
 *
 * Rendered as `kind: 'custom'` in `jiraManifest.wizardSpec`. Maps the
 * CASCADE 'task' / 'subtask' roles to JIRA issue types. Only JIRA uses
 * this concept — Trello has no equivalent, Linear uses workflow states.
 * Stays a custom step rather than an 8th StandardStepKind to avoid
 * speculative abstraction for a single consumer.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IssueTypeMappingStep } from '../../../web/src/components/projects/pm-providers/jira/issue-type-step.js';

const step = { kind: 'custom' as const, id: 'jira-issue-type', component: 'IssueTypeMappingStep' };

const issueTypes = [
	{ name: 'Task', subtask: false },
	{ name: 'Story', subtask: false },
	{ name: 'Sub-task', subtask: true },
];

describe('IssueTypeMappingStep', () => {
	it('renders a row for the task issue type', () => {
		const html = renderToStaticMarkup(
			createElement(IssueTypeMappingStep, {
				step,
				providerId: 'jira',
				issueTypes,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		expect(html).toContain('data-role="task"');
	});

	it('renders a row for the subtask issue type', () => {
		const html = renderToStaticMarkup(
			createElement(IssueTypeMappingStep, {
				step,
				providerId: 'jira',
				issueTypes,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		expect(html).toContain('data-role="subtask"');
	});

	it('populates task dropdown from issueTypes where subtask is false', () => {
		const html = renderToStaticMarkup(
			createElement(IssueTypeMappingStep, {
				step,
				providerId: 'jira',
				issueTypes,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		// The task row's select contains Task + Story, NOT Sub-task.
		const taskSelect = html.match(/<select[^>]*id="issue-type-task"[^>]*>[\s\S]*?<\/select>/)?.[0];
		expect(taskSelect).toBeDefined();
		expect(taskSelect).toContain('Task');
		expect(taskSelect).toContain('Story');
		expect(taskSelect).not.toContain('Sub-task');
	});

	it('populates subtask dropdown from issueTypes where subtask is true', () => {
		const html = renderToStaticMarkup(
			createElement(IssueTypeMappingStep, {
				step,
				providerId: 'jira',
				issueTypes,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		const subtaskSelect = html.match(
			/<select[^>]*id="issue-type-subtask"[^>]*>[\s\S]*?<\/select>/,
		)?.[0];
		expect(subtaskSelect).toBeDefined();
		expect(subtaskSelect).toContain('Sub-task');
		expect(subtaskSelect).not.toContain('Story');
	});

	it('preselects current mappings', () => {
		const html = renderToStaticMarkup(
			createElement(IssueTypeMappingStep, {
				step,
				providerId: 'jira',
				issueTypes,
				mappings: { task: 'Story', subtask: 'Sub-task' },
				onMappingChange: () => {},
			}),
		);
		expect(html).toMatch(/<option[^>]*value="Story"[^>]*selected/);
		expect(html).toMatch(/<option[^>]*value="Sub-task"[^>]*selected/);
	});

	it('renders loading state', () => {
		const html = renderToStaticMarkup(
			createElement(IssueTypeMappingStep, {
				step,
				providerId: 'jira',
				issueTypes: [],
				mappings: {},
				onMappingChange: () => {},
				loading: true,
			}),
		);
		expect(html).toContain('data-state="loading"');
	});

	it('exposes the step component identifier', () => {
		const html = renderToStaticMarkup(
			createElement(IssueTypeMappingStep, {
				step,
				providerId: 'jira',
				issueTypes,
				mappings: {},
				onMappingChange: () => {},
			}),
		);
		expect(html).toContain('data-step-component="issue-type-mapping"');
	});
});
