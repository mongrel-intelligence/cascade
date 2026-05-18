import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadConfig = vi.fn();
const mockCreateDashboardClient = vi.fn();

vi.mock('../../../../../src/cli/dashboard/_shared/config.js', () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

vi.mock('../../../../../src/cli/dashboard/_shared/client.js', () => ({
	createDashboardClient: (...args: unknown[]) => mockCreateDashboardClient(...args),
}));

vi.mock('chalk', () => ({
	default: {
		bold: (s: string) => s,
		blue: (s: string) => s,
		green: (s: string) => s,
		red: (s: string) => s,
		yellow: (s: string) => s,
		dim: (s: string) => s,
	},
}));

import WorkflowStatusesCreate from '../../../../../src/cli/dashboard/workflow-statuses/create.js';
import WorkflowStatusesDelete from '../../../../../src/cli/dashboard/workflow-statuses/delete.js';
import WorkflowStatusesList from '../../../../../src/cli/dashboard/workflow-statuses/list.js';
import WorkflowStatusesUpdate from '../../../../../src/cli/dashboard/workflow-statuses/update.js';

const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

const baseConfig = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };

const statusRow = {
	key: 'prd',
	label: 'PRD',
	agentType: 'prd',
	sortOrder: 1000,
	isBuiltin: false,
};

function makeClient(overrides: Record<string, unknown> = {}) {
	return {
		workflowStatuses: {
			list: { query: vi.fn().mockResolvedValue([statusRow]) },
			create: { mutate: vi.fn().mockResolvedValue(statusRow) },
			update: { mutate: vi.fn().mockResolvedValue(statusRow) },
			delete: { mutate: vi.fn().mockResolvedValue({ key: 'prd' }) },
		},
		...overrides,
	};
}

describe('workflow-statuses CLI', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		oclifConfig.runHook.mockResolvedValue({ successes: [], failures: [] });
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('lists workflow statuses', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesList([], oclifConfig as never);
		await cmd.run();

		expect(client.workflowStatuses.list.query).toHaveBeenCalledWith();
	});

	it('outputs JSON when listing with --json', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesList(['--json'], oclifConfig as never);
		await cmd.run();

		expect(client.workflowStatuses.list.query).toHaveBeenCalledWith();
	});

	it('creates a workflow status with a dispatch agent', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesCreate(
			['--key', 'prd', '--label', 'PRD', '--agent-type', 'prd', '--sort-order', '1000'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.workflowStatuses.create.mutate).toHaveBeenCalledWith({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: 1000,
		});
	});

	it('creates a workflow status with no dispatch agent', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesCreate(['--key', 'qa', '--label', 'QA'], oclifConfig as never);
		await cmd.run();

		expect(client.workflowStatuses.create.mutate).toHaveBeenCalledWith({
			key: 'qa',
			label: 'QA',
			agentType: undefined,
			sortOrder: undefined,
		});
	});

	it('outputs JSON when creating with --json', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesCreate(
			['--key', 'prd', '--label', 'PRD', '--agent-type', 'prd', '--json'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.workflowStatuses.create.mutate).toHaveBeenCalledWith({
			key: 'prd',
			label: 'PRD',
			agentType: 'prd',
			sortOrder: undefined,
		});
	});

	it('surfaces create errors', async () => {
		const client = makeClient({
			workflowStatuses: {
				list: { query: vi.fn().mockResolvedValue([statusRow]) },
				create: { mutate: vi.fn().mockRejectedValue(new Error('duplicate key')) },
				update: { mutate: vi.fn().mockResolvedValue(statusRow) },
				delete: { mutate: vi.fn().mockResolvedValue({ key: 'prd' }) },
			},
		});
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesCreate(
			['--key', 'prd', '--label', 'PRD'],
			oclifConfig as never,
		);
		await expect(cmd.run()).rejects.toThrow('duplicate key');
	});

	it('updates a workflow status', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesUpdate(
			['prd', '--label', 'Product Requirements', '--agent-type', 'prd-v2'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.workflowStatuses.update.mutate).toHaveBeenCalledWith({
			key: 'prd',
			label: 'Product Requirements',
			agentType: 'prd-v2',
			sortOrder: undefined,
		});
	});

	it('updates only sort order', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesUpdate(['prd', '--sort-order', '1100'], oclifConfig as never);
		await cmd.run();

		expect(client.workflowStatuses.update.mutate).toHaveBeenCalledWith({
			key: 'prd',
			label: undefined,
			agentType: undefined,
			sortOrder: 1100,
		});
	});

	it('clears a workflow status dispatch agent', async () => {
		const client = makeClient({
			workflowStatuses: {
				list: { query: vi.fn().mockResolvedValue([statusRow]) },
				create: { mutate: vi.fn().mockResolvedValue(statusRow) },
				update: { mutate: vi.fn().mockResolvedValue({ ...statusRow, agentType: null }) },
				delete: { mutate: vi.fn().mockResolvedValue({ key: 'prd' }) },
			},
		});
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesUpdate(['prd', '--no-agent'], oclifConfig as never);
		await cmd.run();

		expect(client.workflowStatuses.update.mutate).toHaveBeenCalledWith({
			key: 'prd',
			label: undefined,
			agentType: null,
			sortOrder: undefined,
		});
	});

	it('outputs JSON when updating with --json', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesUpdate(
			['prd', '--label', 'Product Requirements', '--json'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.workflowStatuses.update.mutate).toHaveBeenCalledWith({
			key: 'prd',
			label: 'Product Requirements',
			agentType: undefined,
			sortOrder: undefined,
		});
	});

	it('surfaces update errors', async () => {
		const client = makeClient({
			workflowStatuses: {
				list: { query: vi.fn().mockResolvedValue([statusRow]) },
				create: { mutate: vi.fn().mockResolvedValue(statusRow) },
				update: { mutate: vi.fn().mockRejectedValue(new Error('missing status')) },
				delete: { mutate: vi.fn().mockResolvedValue({ key: 'prd' }) },
			},
		});
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesUpdate(['prd', '--label', 'PRD'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow('missing status');
	});

	it('rejects update without changes', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesUpdate(['prd'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
		expect(client.workflowStatuses.update.mutate).not.toHaveBeenCalled();
	});

	it('deletes a workflow status when confirmed', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesDelete(['prd', '--yes'], oclifConfig as never);
		await cmd.run();

		expect(client.workflowStatuses.delete.mutate).toHaveBeenCalledWith({ key: 'prd' });
	});

	it('outputs JSON when deleting with --json', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesDelete(['prd', '--yes', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.workflowStatuses.delete.mutate).toHaveBeenCalledWith({ key: 'prd' });
	});

	it('surfaces delete errors', async () => {
		const client = makeClient({
			workflowStatuses: {
				list: { query: vi.fn().mockResolvedValue([statusRow]) },
				create: { mutate: vi.fn().mockResolvedValue(statusRow) },
				update: { mutate: vi.fn().mockResolvedValue(statusRow) },
				delete: { mutate: vi.fn().mockRejectedValue(new Error('missing status')) },
			},
		});
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesDelete(['prd', '--yes'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow('missing status');
	});

	it('requires --yes for delete', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WorkflowStatusesDelete(['prd'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
		expect(client.workflowStatuses.delete.mutate).not.toHaveBeenCalled();
	});
});
