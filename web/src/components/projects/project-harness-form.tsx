import { ProjectSecretField } from '@/components/projects/project-secret-field.js';
import { useProjectUpdate } from '@/components/projects/use-project-update.js';
import { EngineSettingsFields } from '@/components/settings/engine-settings-fields.js';
import { ModelField } from '@/components/settings/model-field.js';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip.js';
import { trpc } from '@/lib/trpc.js';
import { useQuery } from '@tanstack/react-query';
import { HelpCircle } from 'lucide-react';
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
	engines?: string[];
}> = [
	{
		envVarKey: 'OPENAI_API_KEY',
		label: 'OpenAI API Key',
		description: 'API key for OpenAI/Codex or OpenCode backend.',
		placeholder: 'sk-...',
		engines: ['codex', 'opencode'],
	},
	{
		envVarKey: 'CODEX_AUTH_JSON',
		label: 'Codex Auth JSON',
		description: 'Codex subscription auth.json contents for ChatGPT Plus/Pro.',
		placeholder: '{"token":"..."}',
		engines: ['codex'],
	},
	{
		envVarKey: 'ANTHROPIC_API_KEY',
		label: 'Anthropic API Key',
		description: 'API key for Claude Code (non-subscription) or OpenCode backend.',
		placeholder: 'sk-ant-api03-...',
		engines: ['claude-code', 'opencode'],
	},
	{
		envVarKey: 'CLAUDE_CODE_OAUTH_TOKEN',
		label: 'Claude Code OAuth Token',
		description: 'OAuth token for Claude Code subscription auth.',
		placeholder: 'sk-ant-oat01-...',
		engines: ['claude-code'],
	},
	{
		envVarKey: 'OPENROUTER_API_KEY',
		label: 'OpenRouter API Key',
		description:
			'API key for OpenCode engine. Also configurable on the General tab for LLM routing.',
		placeholder: 'sk-or-...',
		engines: ['opencode'],
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

	// Show engine secrets filtered by selected engine; show all when none selected
	const visibleSecrets = effectiveEngineId
		? ENGINE_SECRETS.filter((s) => !s.engines || s.engines.includes(effectiveEngineId))
		: [];

	return (
		<TooltipProvider>
			<div className="max-w-2xl space-y-6">
				<div>
					<h2 className="text-lg font-semibold">Engine Configuration</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Select the AI engine, configure runtime settings, and manage API credentials.
					</p>
				</div>

				{/* Engine & Runtime Card */}
				<Card>
					<CardHeader>
						<CardTitle>Engine &amp; Runtime</CardTitle>
						<CardDescription>
							Choose which AI engine runs agents and configure its parameters.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit} className="space-y-4" id="engine-runtime-form">
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
								<p className="text-xs text-muted-foreground">
									Determines which AI SDK processes agent runs.
								</p>
							</div>
							<EngineSettingsFields
								engine={effectiveEngine}
								value={engineSettings}
								onChange={(next) => setEngineSettings(next ?? {})}
							/>
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<div className="flex items-center gap-1.5">
										<Label htmlFor="model">Model</Label>
										<Tooltip>
											<TooltipTrigger asChild>
												<HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
											</TooltipTrigger>
											<TooltipContent>
												Individual agents can override this in the Agents tab.
											</TooltipContent>
										</Tooltip>
									</div>
									<ModelField
										id="model"
										value={model}
										onChange={setModel}
										engine={effectiveEngineId}
									/>
									<p className="text-xs text-muted-foreground">
										Project default model. Per-agent overrides in the Agents tab.
									</p>
								</div>
								<div className="space-y-2">
									<div className="flex items-center gap-1.5">
										<Label htmlFor="maxIterations">Max Iterations</Label>
										<Tooltip>
											<TooltipTrigger asChild>
												<HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
											</TooltipTrigger>
											<TooltipContent>
												Individual agents can override this in the Agents tab.
											</TooltipContent>
										</Tooltip>
									</div>
									<Input
										id="maxIterations"
										type="number"
										min="1"
										value={maxIterations}
										onChange={(e) => setMaxIterations(e.target.value)}
										placeholder="e.g. 20"
									/>
									<p className="text-xs text-muted-foreground">
										Safety limit on tool-call iterations per run.
									</p>
								</div>
							</div>
						</form>
					</CardContent>
					<CardFooter>
						<div className="flex items-center gap-2">
							<button
								type="submit"
								form="engine-runtime-form"
								disabled={updateMutation.isPending}
								className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							>
								{updateMutation.isPending ? 'Saving...' : 'Save Changes'}
							</button>
							{updateMutation.isSuccess && (
								<span className="text-sm text-muted-foreground">Saved</span>
							)}
							{updateMutation.isError && (
								<span className="text-sm text-destructive">{updateMutation.error.message}</span>
							)}
						</div>
					</CardFooter>
				</Card>

				{/* Engine Credentials Card */}
				<Card>
					<CardHeader>
						<CardTitle>Engine Credentials</CardTitle>
						<CardDescription>
							API keys and tokens for the agent engine. Values are stored encrypted and never
							returned to the browser.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{!effectiveEngineId ? (
							<p className="text-sm text-muted-foreground">
								Select an engine above to see required credentials.
							</p>
						) : visibleSecrets.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No credentials required for the selected engine.
							</p>
						) : (
							<div className="space-y-4">
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
						)}
					</CardContent>
				</Card>
			</div>
		</TooltipProvider>
	);
}
