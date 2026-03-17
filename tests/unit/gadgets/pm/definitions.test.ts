import { describe, expect, it } from 'vitest';
import {
	addChecklistDef,
	createWorkItemDef,
	listWorkItemsDef,
	moveWorkItemDef,
	pmDeleteChecklistItemDef,
	pmUpdateChecklistItemDef,
	postCommentDef,
	readWorkItemDef,
	updateWorkItemDef,
} from '../../../../src/gadgets/pm/definitions.js';
import type { ToolDefinition } from '../../../../src/gadgets/shared/toolDefinition.js';

const ALL_PM_DEFINITIONS: ToolDefinition[] = [
	readWorkItemDef,
	postCommentDef,
	updateWorkItemDef,
	createWorkItemDef,
	listWorkItemsDef,
	moveWorkItemDef,
	addChecklistDef,
	pmUpdateChecklistItemDef,
	pmDeleteChecklistItemDef,
];

describe('PM gadget definitions', () => {
	describe('all definitions integrity', () => {
		it('exports exactly 9 definitions', () => {
			expect(ALL_PM_DEFINITIONS).toHaveLength(9);
		});

		it('all definitions have unique names', () => {
			const names = ALL_PM_DEFINITIONS.map((d) => d.name);
			const uniqueNames = new Set(names);
			expect(uniqueNames.size).toBe(names.length);
		});

		it('every definition has a non-empty name', () => {
			for (const def of ALL_PM_DEFINITIONS) {
				expect(typeof def.name).toBe('string');
				expect(def.name.length).toBeGreaterThan(0);
			}
		});

		it('every definition has a non-empty description', () => {
			for (const def of ALL_PM_DEFINITIONS) {
				expect(typeof def.description).toBe('string');
				expect(def.description.length).toBeGreaterThan(0);
			}
		});

		it('every definition has a timeoutMs greater than 0', () => {
			for (const def of ALL_PM_DEFINITIONS) {
				if (def.timeoutMs !== undefined) {
					expect(def.timeoutMs).toBeGreaterThan(0);
				}
			}
		});

		it('every definition has a parameters object', () => {
			for (const def of ALL_PM_DEFINITIONS) {
				expect(typeof def.parameters).toBe('object');
				expect(def.parameters).not.toBeNull();
			}
		});

		it('every definition has at least one example', () => {
			for (const def of ALL_PM_DEFINITIONS) {
				expect(Array.isArray(def.examples)).toBe(true);
				expect((def.examples ?? []).length).toBeGreaterThan(0);
			}
		});

		it('all parameter descriptions are non-empty', () => {
			for (const def of ALL_PM_DEFINITIONS) {
				for (const [paramName, paramDef] of Object.entries(def.parameters)) {
					expect(
						typeof paramDef.describe === 'string' && paramDef.describe.length > 0,
						`Parameter '${paramName}' in '${def.name}' must have a non-empty describe`,
					).toBe(true);
				}
			}
		});

		it('all definition names are PascalCase', () => {
			for (const def of ALL_PM_DEFINITIONS) {
				expect(def.name).toMatch(/^[A-Z][a-zA-Z0-9]+$/);
			}
		});
	});

	describe('expected tool names are present', () => {
		it('includes ReadWorkItem', () => {
			expect(ALL_PM_DEFINITIONS.map((d) => d.name)).toContain('ReadWorkItem');
		});

		it('includes PostComment', () => {
			expect(ALL_PM_DEFINITIONS.map((d) => d.name)).toContain('PostComment');
		});

		it('includes UpdateWorkItem', () => {
			expect(ALL_PM_DEFINITIONS.map((d) => d.name)).toContain('UpdateWorkItem');
		});

		it('includes CreateWorkItem', () => {
			expect(ALL_PM_DEFINITIONS.map((d) => d.name)).toContain('CreateWorkItem');
		});

		it('includes ListWorkItems', () => {
			expect(ALL_PM_DEFINITIONS.map((d) => d.name)).toContain('ListWorkItems');
		});

		it('includes MoveWorkItem', () => {
			expect(ALL_PM_DEFINITIONS.map((d) => d.name)).toContain('MoveWorkItem');
		});

		it('includes AddChecklist', () => {
			expect(ALL_PM_DEFINITIONS.map((d) => d.name)).toContain('AddChecklist');
		});

		it('includes PMUpdateChecklistItem', () => {
			expect(ALL_PM_DEFINITIONS.map((d) => d.name)).toContain('PMUpdateChecklistItem');
		});

		it('includes PMDeleteChecklistItem', () => {
			expect(ALL_PM_DEFINITIONS.map((d) => d.name)).toContain('PMDeleteChecklistItem');
		});
	});

	// ─── ReadWorkItem specific ────────────────────────────────────────────────
	describe('readWorkItemDef', () => {
		it('has required workItemId parameter', () => {
			expect(readWorkItemDef.parameters.workItemId?.required).toBe(true);
			expect(readWorkItemDef.parameters.workItemId?.type).toBe('string');
		});

		it('has optional includeComments boolean with default=true', () => {
			const includeComments = readWorkItemDef.parameters.includeComments;
			expect(includeComments?.type).toBe('boolean');
			expect(includeComments?.optional).toBe(true);
			expect((includeComments as { default?: boolean })?.default).toBe(true);
		});
	});

	// ─── PostComment specific ─────────────────────────────────────────────────
	describe('postCommentDef', () => {
		it('has required workItemId and text parameters', () => {
			expect(postCommentDef.parameters.workItemId?.required).toBe(true);
			expect(postCommentDef.parameters.text?.required).toBe(true);
		});

		it('has text file input alternative', () => {
			const textAlt = postCommentDef.cli?.fileInputAlternatives?.find(
				(a) => a.paramName === 'text',
			);
			expect(textAlt).toBeDefined();
			expect(textAlt?.fileFlag).toBe('text-file');
		});
	});

	// ─── UpdateWorkItem specific ──────────────────────────────────────────────
	describe('updateWorkItemDef', () => {
		it('has required workItemId parameter', () => {
			expect(updateWorkItemDef.parameters.workItemId?.required).toBe(true);
		});

		it('title and description are optional', () => {
			expect(updateWorkItemDef.parameters.title?.optional).toBe(true);
			expect(updateWorkItemDef.parameters.description?.optional).toBe(true);
		});

		it('addLabelId is an optional array parameter', () => {
			expect(updateWorkItemDef.parameters.addLabelId?.type).toBe('array');
			expect(updateWorkItemDef.parameters.addLabelId?.optional).toBe(true);
		});

		it('has description file input alternative', () => {
			const descAlt = updateWorkItemDef.cli?.fileInputAlternatives?.find(
				(a) => a.paramName === 'description',
			);
			expect(descAlt).toBeDefined();
			expect(descAlt?.fileFlag).toBe('description-file');
		});
	});

	// ─── CreateWorkItem specific ──────────────────────────────────────────────
	describe('createWorkItemDef', () => {
		it('has required containerId and title parameters', () => {
			expect(createWorkItemDef.parameters.containerId?.required).toBe(true);
			expect(createWorkItemDef.parameters.title?.required).toBe(true);
		});

		it('description is optional', () => {
			expect(createWorkItemDef.parameters.description?.optional).toBe(true);
		});
	});

	// ─── ListWorkItems specific ────────────────────────────────────────────────
	describe('listWorkItemsDef', () => {
		it('has required containerId parameter', () => {
			expect(listWorkItemsDef.parameters.containerId?.required).toBe(true);
		});
	});

	// ─── MoveWorkItem specific ─────────────────────────────────────────────────
	describe('moveWorkItemDef', () => {
		it('has required workItemId and destination parameters', () => {
			expect(moveWorkItemDef.parameters.workItemId?.required).toBe(true);
			expect(moveWorkItemDef.parameters.destination?.required).toBe(true);
		});
	});

	// ─── AddChecklist specific ─────────────────────────────────────────────────
	describe('addChecklistDef', () => {
		it('has required workItemId, checklistName, and item parameters', () => {
			expect(addChecklistDef.parameters.workItemId?.required).toBe(true);
			expect(addChecklistDef.parameters.checklistName?.required).toBe(true);
			expect(addChecklistDef.parameters.item?.required).toBe(true);
		});

		it('item is an array type', () => {
			expect(addChecklistDef.parameters.item?.type).toBe('array');
		});
	});

	// ─── PMUpdateChecklistItem specific ────────────────────────────────────────
	describe('pmUpdateChecklistItemDef', () => {
		it('has required workItemId, checkItemId, and state parameters', () => {
			expect(pmUpdateChecklistItemDef.parameters.workItemId?.required).toBe(true);
			expect(pmUpdateChecklistItemDef.parameters.checkItemId?.required).toBe(true);
			expect(pmUpdateChecklistItemDef.parameters.state?.required).toBe(true);
		});

		it('state is an enum with complete and incomplete options', () => {
			const state = pmUpdateChecklistItemDef.parameters.state;
			expect(state?.type).toBe('enum');
			const options = (state as { options?: string[] })?.options ?? [];
			expect(options).toContain('complete');
			expect(options).toContain('incomplete');
		});
	});

	// ─── PMDeleteChecklistItem specific ────────────────────────────────────────
	describe('pmDeleteChecklistItemDef', () => {
		it('has required workItemId and checkItemId parameters', () => {
			expect(pmDeleteChecklistItemDef.parameters.workItemId?.required).toBe(true);
			expect(pmDeleteChecklistItemDef.parameters.checkItemId?.required).toBe(true);
		});
	});
});
