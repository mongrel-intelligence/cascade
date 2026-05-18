import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearAgentTypeReferences,
	createCustomWorkflowStatusDefinition,
	deleteCustomWorkflowStatusDefinition,
	getCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions,
	updateCustomWorkflowStatusDefinition,
} from '../../../src/db/repositories/workflowStatusDefinitionsRepository.js';
import {
	getBuiltinWorkflowStatusDefinition,
	listWorkflowStatusDefinitions,
	resolveWorkflowStatusDefinition,
} from '../../../src/workflow/statusDefinitions.js';
import { truncateAll } from '../helpers/db.js';

describe('workflowStatusDefinitionsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
	});

	it('persists custom workflow statuses and lists them by sort order then key', async () => {
		await createCustomWorkflowStatusDefinition({
			key: 'story',
			label: 'Story',
			agentType: 'story',
			sortOrder: 20,
		});
		await createCustomWorkflowStatusDefinition({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 10,
		});
		await createCustomWorkflowStatusDefinition({
			key: 'qa',
			label: 'QA',
			agentType: null,
			sortOrder: 20,
		});

		const statuses = await listCustomWorkflowStatusDefinitions();

		expect(statuses.map((status) => status.key)).toEqual(['prd', 'qa', 'story']);
		expect(statuses[0]).toMatchObject({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 10,
		});
		expect(statuses[0].createdAt).toBeInstanceOf(Date);
		expect(statuses[0].updatedAt).toBeInstanceOf(Date);
	});

	it('enforces unique status keys at the database level', async () => {
		await createCustomWorkflowStatusDefinition({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
		});

		await expect(
			createCustomWorkflowStatusDefinition({
				key: 'prd',
				label: 'Duplicate PRD',
				agentType: 'other-agent',
			}),
		).rejects.toThrow();
	});

	it('updates nullable agent mappings and deletes rows', async () => {
		await createCustomWorkflowStatusDefinition({
			key: 'story',
			label: 'Story',
			agentType: 'story',
			sortOrder: 20,
		});

		const updated = await updateCustomWorkflowStatusDefinition('story', {
			label: 'User Story',
			agentType: null,
			sortOrder: 15,
		});

		expect(updated).toMatchObject({
			key: 'story',
			label: 'User Story',
			agentType: null,
			sortOrder: 15,
		});
		expect(await getCustomWorkflowStatusDefinition('story')).toMatchObject({
			label: 'User Story',
			agentType: null,
		});
		expect(await deleteCustomWorkflowStatusDefinition('story')).toBe(true);
		expect(await getCustomWorkflowStatusDefinition('story')).toBeNull();
		expect(await deleteCustomWorkflowStatusDefinition('story')).toBe(false);
	});

	it('clears matching agent type references without touching other statuses', async () => {
		await createCustomWorkflowStatusDefinition({
			key: 'story',
			label: 'Story',
			agentType: 'story-agent',
		});
		await createCustomWorkflowStatusDefinition({
			key: 'prd',
			label: 'PRD',
			agentType: 'story-agent',
		});
		await createCustomWorkflowStatusDefinition({
			key: 'qa',
			label: 'QA',
			agentType: null,
		});
		await createCustomWorkflowStatusDefinition({
			key: 'plan',
			label: 'Plan',
			agentType: 'plan-agent',
		});

		await expect(clearAgentTypeReferences('story-agent')).resolves.toBe(2);

		await expect(getCustomWorkflowStatusDefinition('story')).resolves.toMatchObject({
			agentType: null,
		});
		await expect(getCustomWorkflowStatusDefinition('prd')).resolves.toMatchObject({
			agentType: null,
		});
		await expect(getCustomWorkflowStatusDefinition('qa')).resolves.toMatchObject({
			agentType: null,
		});
		await expect(getCustomWorkflowStatusDefinition('plan')).resolves.toMatchObject({
			agentType: 'plan-agent',
		});
		await expect(clearAgentTypeReferences('story-agent')).resolves.toBe(0);
	});

	it('merges built-in workflow statuses with custom database statuses', async () => {
		await createCustomWorkflowStatusDefinition({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd-agent',
			sortOrder: 5,
		});

		const statuses = await listWorkflowStatusDefinitions();
		const backlog = statuses.find((status) => status.key === 'backlog');
		const prd = statuses.find((status) => status.key === 'prd');

		expect(backlog).toMatchObject({
			key: 'backlog',
			label: 'Backlog',
			agentType: 'backlog-manager',
			isBuiltin: true,
		});
		expect(prd).toMatchObject({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd-agent',
			sortOrder: 5,
			isBuiltin: false,
		});
		expect(statuses.at(0)?.key).toBe('backlog');
		expect(statuses.at(-1)?.key).toBe('prd');
	});

	it('resolves built-in statuses from code and custom statuses from the database', async () => {
		await createCustomWorkflowStatusDefinition({
			key: 'story',
			label: 'Story',
			agentType: 'story-agent',
		});

		expect(getBuiltinWorkflowStatusDefinition('todo')).toMatchObject({
			key: 'todo',
			agentType: 'implementation',
			isBuiltin: true,
		});
		await expect(resolveWorkflowStatusDefinition('todo')).resolves.toMatchObject({
			key: 'todo',
			agentType: 'implementation',
			isBuiltin: true,
		});
		await expect(resolveWorkflowStatusDefinition('story')).resolves.toMatchObject({
			key: 'story',
			agentType: 'story-agent',
			isBuiltin: false,
		});
		await expect(resolveWorkflowStatusDefinition('missing-status')).resolves.toBeUndefined();
	});
});
