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
	reportFrictionDef,
	updateWorkItemDef,
} from '../../../../src/gadgets/pm/definitions.js';
import type { ToolDefinition } from '../../../../src/gadgets/shared/toolDefinition.js';

const ALL_PM_DEFINITIONS: ToolDefinition[] = [
	readWorkItemDef,
	postCommentDef,
	updateWorkItemDef,
	createWorkItemDef,
	reportFrictionDef,
	listWorkItemsDef,
	moveWorkItemDef,
	addChecklistDef,
	pmUpdateChecklistItemDef,
	pmDeleteChecklistItemDef,
];

describe('PM gadget definitions', () => {
	describe('all definitions integrity', () => {
		it('exports exactly 10 definitions', () => {
			expect(ALL_PM_DEFINITIONS).toHaveLength(10);
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

		it('includes ReportFriction', () => {
			expect(ALL_PM_DEFINITIONS.map((d) => d.name)).toContain('ReportFriction');
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

	describe('reportFrictionDef', () => {
		it('has required summary, details, category, and severity parameters', () => {
			expect(reportFrictionDef.parameters.summary?.required).toBe(true);
			expect(reportFrictionDef.parameters.details?.required).toBe(true);
			expect(reportFrictionDef.parameters.category?.required).toBe(true);
			expect(reportFrictionDef.parameters.severity?.required).toBe(true);
		});

		it('category and severity accept any string with example values surfaced via describe', () => {
			// 2026-05-10: deliberately loosened from `type: 'enum'` after prod run
			// `ff6adf00` showed an agent recognizing a textbook friction but
			// failing to file because oclif's enum gate rejected
			// `--severity 'medium slowdown'` (the agent took the prior describe
			// text "Severity: low annoyance, medium slowdown, ..." literally).
			// Free-form for now; cluster + re-tighten once we have real usage data.
			const category = reportFrictionDef.parameters.category;
			const severity = reportFrictionDef.parameters.severity;

			expect(category?.type).toBe('string');
			expect(severity?.type).toBe('string');

			// Pin the explicit absence of `options` so a future revert to enum
			// fails this test loudly.
			expect((category as { options?: unknown }).options).toBeUndefined();
			expect((severity as { options?: unknown }).options).toBeUndefined();

			// Pin the new describe text — values listed inside parentheses
			// instead of mixed with prose, which is what made the agent take
			// the description as the literal value.
			expect(category?.describe).toBe(
				'Friction category (e.g. tooling, environment, permissions, dependency, test-failure, pm-data, scm-data, other)',
			);
			expect(severity?.describe).toBe('Severity (e.g. low, medium, high, critical)');
		});

		it('has details file input alternative', () => {
			const detailsAlt = reportFrictionDef.cli?.fileInputAlternatives?.find(
				(a) => a.paramName === 'details',
			);
			expect(detailsAlt).toBeDefined();
			expect(detailsAlt?.fileFlag).toBe('details-file');
		});
	});

	// ─── ListWorkItems specific ────────────────────────────────────────────────
	describe('listWorkItemsDef', () => {
		it('has optional containerId and status parameters', () => {
			expect(listWorkItemsDef.parameters.containerId?.optional).toBe(true);
			expect(listWorkItemsDef.parameters.status?.optional).toBe(true);
			expect(listWorkItemsDef.parameters.status?.type).toBe('string');
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
		it('keeps timeout above the description mutation lock wait budget', () => {
			expect(addChecklistDef.timeoutMs).toBe(60_000);
		});

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
		it('keeps timeout above the description mutation lock wait budget', () => {
			expect(pmUpdateChecklistItemDef.timeoutMs).toBe(60_000);
		});

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
		it('keeps timeout above the description mutation lock wait budget', () => {
			expect(pmDeleteChecklistItemDef.timeoutMs).toBe(60_000);
		});

		it('has required workItemId and checkItemId parameters', () => {
			expect(pmDeleteChecklistItemDef.parameters.workItemId?.required).toBe(true);
			expect(pmDeleteChecklistItemDef.parameters.checkItemId?.required).toBe(true);
		});
	});

	// ─── Output shape coverage (MNG-1427) ──────────────────────────────────────
	describe('output shape coverage (MNG-1427)', () => {
		const MUTATION_DEFS_WITH_REQUIRED_OUTPUT_SHAPE: ToolDefinition[] = [
			postCommentDef,
			updateWorkItemDef,
			createWorkItemDef,
			moveWorkItemDef,
			addChecklistDef,
			pmUpdateChecklistItemDef,
			pmDeleteChecklistItemDef,
		];

		const READ_ONLY_DEFS_WITHOUT_OUTPUT_SHAPE: ToolDefinition[] = [
			readWorkItemDef,
			listWorkItemsDef,
		];

		it('every PM mutation definition declares an outputShape with at least one field', () => {
			for (const def of MUTATION_DEFS_WITH_REQUIRED_OUTPUT_SHAPE) {
				expect(def.outputShape, `${def.name} must declare outputShape`).toBeDefined();
				expect(
					def.outputShape?.fields.length,
					`${def.name} outputShape must list at least one field`,
				).toBeGreaterThan(0);
			}
		});

		it('every output-shape field has a non-empty name and type', () => {
			for (const def of MUTATION_DEFS_WITH_REQUIRED_OUTPUT_SHAPE) {
				for (const field of def.outputShape?.fields ?? []) {
					expect(typeof field.name).toBe('string');
					expect(field.name.length).toBeGreaterThan(0);
					expect(typeof field.type).toBe('string');
					expect(field.type.length).toBeGreaterThan(0);
				}
			}
		});

		it('read-only definitions do not declare an outputShape', () => {
			for (const def of READ_ONLY_DEFS_WITHOUT_OUTPUT_SHAPE) {
				expect(def.outputShape, `${def.name} must NOT declare outputShape`).toBeUndefined();
			}
		});

		it('PostComment output shape mirrors the CommentPostedResult contract', () => {
			const names = postCommentDef.outputShape?.fields.map((f) => f.name) ?? [];
			expect(names).toContain('status');
			expect(names).toContain('id');
			expect(names).toContain('workItemId');
			expect(names).toContain('workItemUrl');
			expect(names).toContain('updatedAt');
		});

		it('UpdateWorkItem output shape mirrors the WorkItemUpdatedResult contract', () => {
			const fieldsByName = new Map(
				(updateWorkItemDef.outputShape?.fields ?? []).map((f) => [f.name, f]),
			);
			expect(fieldsByName.get('status')?.type).toBe('"updated" | "noop"');
			expect(fieldsByName.get('changedFields')?.type).toBe('("title" | "description")[]');
			expect(fieldsByName.get('addedLabelIds')?.type).toBe('string[]');
			expect(fieldsByName.get('message')?.optional).toBe(true);
		});

		it('MoveWorkItem output shape encodes the moved/noop/aborted union', () => {
			const status = moveWorkItemDef.outputShape?.fields.find((f) => f.name === 'status');
			expect(status?.type).toBe('"moved" | "noop" | "aborted"');
			const previousStatus = moveWorkItemDef.outputShape?.fields.find(
				(f) => f.name === 'previousStatus',
			);
			expect(previousStatus?.optional).toBe(true);
		});

		it('CreateWorkItem output shape includes workflowStatus / workflowStatusId as optional', () => {
			const fieldsByName = new Map(
				(createWorkItemDef.outputShape?.fields ?? []).map((f) => [f.name, f]),
			);
			expect(fieldsByName.get('workflowStatus')?.optional).toBe(true);
			expect(fieldsByName.get('workflowStatusId')?.optional).toBe(true);
		});

		it('AddChecklist output shape carries checklistId + itemIds', () => {
			const names = addChecklistDef.outputShape?.fields.map((f) => f.name) ?? [];
			expect(names).toContain('checklistId');
			expect(names).toContain('itemIds');
			expect(names).toContain('itemCount');
		});

		it('PMUpdateChecklistItem output shape surfaces the resulting boolean state', () => {
			const complete = pmUpdateChecklistItemDef.outputShape?.fields.find(
				(f) => f.name === 'complete',
			);
			expect(complete?.type).toBe('boolean');
		});

		it('PMDeleteChecklistItem output shape uses status="deleted"', () => {
			const status = pmDeleteChecklistItemDef.outputShape?.fields.find((f) => f.name === 'status');
			expect(status?.type).toBe('"deleted"');
		});
	});
});
