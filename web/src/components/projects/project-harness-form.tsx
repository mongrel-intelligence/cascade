import { ProjectSecretField } from '@/components/projects/project-secret-field.js';
import { useProjectUpdate } from '@/components/projects/use-project-update.js';
import { EngineSettingsFields } from '@/components/settings/engine-settings-fields.js';
import { ModelField } from '@/components/settings/model-field.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface Project {
	id: string;
	model: string | null;
	maxIterations: number | null;
	agentEngine: string | null;
	engineSettings: Record<string, Record<string, unknown>> | null;
}

function numericFieldDefault(value: number | null | undefined): string {
	return value != null ? String(value) : '';
}

const ENGINE_SECRETS: Array<{
	envVarKey: string;
	label: string;
	description: string;
	placeholder?: string;
	engine?: string;
}> = [
	{
		envVarKey: 'OPENAI_API_KEY',
		label: 'OpenAI API Key',
		description: 'API key for OpenAI/Codex backend.',
		placeholder: 'sk-...',
		engine: 'codex',
	},
	{
		envVarKey: 'CODEX_AUTH_JSON',
		label: 'Codex Auth JSON',
		description: 'Codex subscription auth.json contents for ChatGPT Plus/Pro.',
		placeholder: '{"token":"..."}',
		engine: 'codex',
	},
	{
		envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN',
		label: 'Claude Code OAuth Token',
		description: 'OAuth token for Claude Code subscription auth.',
		placeholder: 'sk-ant-oat01-...',
		engine: 'claude-code',
	},
];

export function ProjectHarnessForm({ project }: { project: Project }) {
	const updateMutation = useProjectUpdate(project.id);
	const enginesQuery = useQuery(trpc.agentConfigs.engines.queryOptions());
	const credentialsQuery = useQuery(
		trpc.projects.credentials.list.queryOptions({ projectId: project.id }),
	);

	const [model, setModel] = useState(project.model ?? '');
	const [maxIterations, setMaxIterations] = useState(numericFieldDefault(project.maxIterations));
	const [agentEngine, setAgentEngine] = useState(project.agentEngine ?? '');
	const [engineSettings, setEngineSettings] = useState<Record<string, Record<string, unknown>>>(
		project.engineSettings ?? {},
	);

	const effectiveEngineId = agentEngine || '';
	const effectiveEngine = enginesQuery.data?.find((engine) => engine.id === effectiveEngineId);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		const activeEngine = agentEngine || null;
		const activeEngineSettings =
			activeEngine && engineSettings[activeEngine]
				? { [activeEngine]: engineSettings[activeEngine] }
				: null;
		updateMutation.mutate({
			model: model || null,
			maxIterations: maxIterations ? Number.parseInt(maxIterations, 10) : null,
			agentEngine: activeEngine,
			engineSettings: activeEngineSettings,
		});
	}

	const credentials = credentialsQuery.data ?? [];

	// Show all engine secrets or filter by selected engine
	const visibleSecrets = effectiveEngineId
		? ENGINE_SECRETS.filter((s) => !s.engine || s.engine === effectiveEngineId)
		: ENGINE_SECRETS;

	return (
		<div className="max-w-2xl space-y-6">
			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="space-y-2">
					<Label>Agent Engine</Label>
					<Select
						value={agentEngine || '_none'}
						onValueChange={(v) => setAgentEngine(v === '_none' ? '' : v)}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Select engine" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="_none">None</SelectItem>
							{enginesQuery.data?.map((engine) => (
								<SelectItem key={engine.id} value={engine.id}>
									{engine.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<EngineSettingsFields
					engine={effectiveEngine}
					value={engineSettings}
					onChange={(next) => setEngineSettings(next ?? {})}
				/>
				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label htmlFor="model">Model</Label>
						<ModelField id="model" value={model} onChange={setModel} engine={effectiveEngineId} />
					</div>
					<div className="space-y-2">
						<Label htmlFor="maxIterations">Max Iterations</Label>
						<Input
							id="maxIterations"
							type="number"
							min="1"
							value={maxIterations}
							onChange={(e) => setMaxIterations(e.target.value)}
							placeholder="e.g. 20"
						/>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="submit"
						disabled={updateMutation.isPending}
						className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{updateMutation.isPending ? 'Saving...' : 'Save Changes'}
					</button>
					{updateMutation.isSuccess && <span className="text-sm text-muted-foreground">Saved</span>}
					{updateMutation.isError && (
						<span className="text-sm text-destructive">{updateMutation.error.message}</span>
					)}
				</div>
			</form>

			{/* Secrets section */}
			<div className="space-y-4 border-t pt-4">
				<div>
					<h3 className="text-sm font-medium">Engine Secrets</h3>
					<p className="text-xs text-muted-foreground mt-1">
						API keys and tokens for the agent engine. Values are stored encrypted and never returned
						to the browser.
					</p>
				</div>
				{visibleSecrets.map((secret) => (
					<ProjectSecretField
						key={secret.envVarKey}
						projectId={project.id}
						envVarKey={secret.envVarKey}
						label={secret.label}
						description={secret.description}
						placeholder={secret.placeholder}
						credential={credentials.find((c) => c.envVarKey === secret.envVarKey)}
					/>
				))}
			</div>
		</div>
	);
}
