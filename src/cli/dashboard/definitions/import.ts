import { readFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

type AgentDefinitionInput = Parameters<
	ReturnType<typeof createDashboardClientPlaceholder>['agentDefinitions']['create']['mutate']
>[0]['definition'];

// Placeholder to satisfy TypeScript — the actual client type is inferred at runtime.
function createDashboardClientPlaceholder() {
	return {} as InstanceType<typeof DashboardCommand>['client'];
}

async function parseFileContent(raw: string): Promise<unknown> {
	const trimmed = raw.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		return JSON.parse(raw);
	}
	const yaml = await import('js-yaml');
	return yaml.load(raw);
}

function readRawFile(filePath: string): string {
	return filePath === '-' ? readFileSync(0, 'utf-8') : readFileSync(filePath, 'utf-8');
}

function isConflictError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return message.includes('already exists') || message.includes('CONFLICT');
}

export default class DefinitionsImport extends DashboardCommand {
	static override description = 'Import an agent definition from a JSON or YAML file.';

	static override flags = {
		...DashboardCommand.baseFlags,
		file: Flags.string({
			description: 'Path to JSON or YAML definition file (use - for stdin)',
			char: 'f',
			required: true,
		}),
		'agent-type': Flags.string({
			description:
				'Agent type to use (overrides agentType from file if set). Required if file does not include agentType.',
		}),
		update: Flags.boolean({
			description: 'If the definition already exists, update it instead of failing',
			default: false,
		}),
	};

	private async createDefinition(agentType: string, definition: AgentDefinitionInput) {
		return this.client.agentDefinitions.create.mutate({ agentType, definition });
	}

	private async updateDefinition(agentType: string, definition: AgentDefinitionInput) {
		return this.client.agentDefinitions.update.mutate({
			agentType,
			patch: definition as Parameters<
				typeof this.client.agentDefinitions.update.mutate
			>[0]['patch'],
		});
	}

	private async upsertDefinition(agentType: string, definition: AgentDefinitionInput) {
		try {
			const result = await this.createDefinition(agentType, definition);
			return { action: 'created' as const, ...result };
		} catch (err: unknown) {
			if (!isConflictError(err)) throw err;
			const result = await this.updateDefinition(agentType, definition);
			return { action: 'updated' as const, ...result };
		}
	}

	async run(): Promise<void> {
		const { flags } = await this.parse(DefinitionsImport);

		try {
			const raw = readRawFile(flags.file);
			const parsed = await parseFileContent(raw);

			if (typeof parsed !== 'object' || parsed === null) {
				this.error('File must contain a JSON or YAML object.');
			}

			const obj = parsed as Record<string, unknown>;
			const agentType = flags['agent-type'] ?? (obj.agentType as string | undefined);
			if (!agentType) {
				this.error('agentType not found in file. Pass --agent-type to specify it explicitly.');
			}

			const definition = (obj.definition ?? obj) as AgentDefinitionInput;

			if (flags.update) {
				const result = await this.upsertDefinition(agentType, definition);
				if (flags.json) {
					this.outputJson(result);
					return;
				}
				this.log(`Imported (${result.action}) agent definition: ${result.agentType}`);
			} else {
				const result = await this.createDefinition(agentType, definition);
				if (flags.json) {
					this.outputJson({ action: 'created', ...result });
					return;
				}
				this.log(`Imported agent definition: ${result.agentType}`);
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
