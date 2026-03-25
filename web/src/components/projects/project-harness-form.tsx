import { ENGINE_SECRETS } from '@/components/projects/engine-secrets.js';
import { ProjectSecretField } from '@/components/projects/project-secret-field.js';
import { useProjectUpdate } from '@/components/projects/use-project-update.js';
import { EngineSettingsFields } from '@/components/settings/engine-settings-fields.js';
import { ModelField } from '@/components/settings/model-field.js';
import { Badge } from '@/components/ui/badge.js';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.js';
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

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multiple query dependencies and per-engine tab rendering for credentials and settings
export function ProjectHarnessForm({ project }: { project: Project }) {
	const updateMutation = useProjectUpdate(project.id);
	const enginesQuery = useQuery(trpc.agentConfigs.engines.queryOptions());
	const credentialsQuery = useQuery(
		trpc.projects.credentials.list.queryOptions({ projectId: project.id }),
	);
	const defaultsQuery = useQuery({
		...trpc.projects.defaults.queryOptions(),
		staleTime: Number.POSITIVE_INFINITY,
	});
	const enginesInUseQuery = useQuery(
		trpc.agentConfigs.enginesInUse.queryOptions({ projectId: project.id }),
	);
	const defaults = defaultsQuery.data;

	const [model, setModel] = useState(project.model ?? '');
	const [maxIterations, setMaxIterations] = useState(numericFieldDefault(project.maxIterations));
	const [agentEngine, setAgentEngine] = useState(project.agentEngine ?? '');
	const [engineSettings, setEngineSettings] = useState<Record<string, Record<string, unknown>>>(
		project.engineSettings ?? {},
	);

	// Derived values
	const engines = enginesQuery.data ?? [];
	const credentials = credentialsQuery.data ?? [];
	const agentEnginesInUse = enginesInUseQuery.data ?? [];

	// System default engine (e.g. 'claude-code') shown when no project-level engine is set
	const systemDefaultEngineId = defaults?.agentEngine ?? 'claude-code';
	// The effective project-level engine: either explicitly set or the system default
	const effectiveEngineId = agentEngine || systemDefaultEngineId;

	// Default tab to show: project's selected engine, or system default
	const defaultTab = effectiveEngineId;

	// Resolved engine defaults for EngineSettingsFields
	function getEngineDefaults(engineId: string): Record<string, unknown> | undefined {
		return defaults
			? (defaults.engineSettings as Record<string, Record<string, unknown>>)[engineId]
			: undefined;
	}

	// Default engine label for the select placeholder
	const defaultEngineLabel = defaults ? `Default (${capitalize(defaults.agentEngine)})` : 'Default';

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		const activeEngine = agentEngine || null;
		// Save all engine settings, not just the active engine
		const allEngineSettings = Object.keys(engineSettings).length > 0 ? engineSettings : null;
		updateMutation.mutate({
			model: model || null,
			maxIterations: maxIterations ? Number.parseInt(maxIterations, 10) : null,
			agentEngine: activeEngine,
			engineSettings: allEngineSettings,
		});
	}

	return (
		<TooltipProvider>
			<div className="max-w-2xl space-y-6">
				<div>
					<h2 className="text-lg font-semibold">Engine Configuration</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Select the AI engine, configure runtime settings, and manage API credentials.
					</p>
				</div>

				{/* Model & Iterations Card — engine-agnostic, always visible */}
				<Card>
					<CardHeader>
						<CardTitle>Model &amp; Runtime</CardTitle>
						<CardDescription>
							Global model and iteration settings applied to all agents unless overridden per-agent.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit} className="space-y-4" id="engine-runtime-form">
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
									defaultLabel={defaults ? defaults.model : undefined}
									projectId={project.id}
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
									step="1"
									className="w-32"
									value={maxIterations}
									onChange={(e) => setMaxIterations(e.target.value)}
									placeholder={defaults ? `${defaults.maxIterations} (default)` : 'e.g. 50'}
								/>
								<p className="text-xs text-muted-foreground">
									Safety limit on tool-call iterations per run.
								</p>
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

				{/* Per-engine tabs: credentials + settings + default toggle */}
				<Card>
					<CardHeader>
						<CardTitle>Engine Settings &amp; Credentials</CardTitle>
						<CardDescription>
							Configure each engine's credentials and settings. The default engine tab is
							highlighted. New engines are added automatically as the catalog expands.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{engines.length === 0 ? (
							<p className="text-sm text-muted-foreground">Loading engines…</p>
						) : (
							<Tabs defaultValue={defaultTab}>
								<TabsList className="flex w-full h-auto flex-wrap">
									{engines.map((engine) => {
										const isDefault = engine.id === effectiveEngineId;
										const isUsedByAgents = agentEnginesInUse.includes(engine.id);
										return (
											<TabsTrigger
												key={engine.id}
												value={engine.id}
												className="flex items-center gap-1.5"
											>
												{engine.label}
												{isDefault && (
													<Badge variant="secondary" className="text-xs px-1 py-0">
														Default
													</Badge>
												)}
												{!isDefault && isUsedByAgents && (
													<Badge variant="outline" className="text-xs px-1 py-0">
														In use
													</Badge>
												)}
											</TabsTrigger>
										);
									})}
								</TabsList>

								{engines.map((engine) => {
									const isDefault = engine.id === effectiveEngineId;
									const isUsedByAgents = agentEnginesInUse.includes(engine.id);
									const engineSecrets = ENGINE_SECRETS.filter((s) =>
										s.engines?.includes(engine.id),
									);
									// Secrets shared with other engines: show a note
									const sharedSecretEngines = (envVarKey: string): string[] => {
										const secret = ENGINE_SECRETS.find((s) => s.envVarKey === envVarKey);
										if (!secret?.engines) return [];
										return secret.engines.filter((e) => e !== engine.id);
									};

									const engineDefaults = getEngineDefaults(engine.id);

									return (
										<TabsContent key={engine.id} value={engine.id} className="mt-4 space-y-6">
											{/* Engine description */}
											{engine.description && (
												<p className="text-sm text-muted-foreground">{engine.description}</p>
											)}

											{/* Default engine indicator / Set as Default button */}
											<div className="flex items-center gap-3">
												{isDefault ? (
													<div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
														<span className="text-muted-foreground">
															✓ Default engine for this project
															{agentEngine === '' &&
																` (inheriting system default: ${capitalize(systemDefaultEngineId)})`}
														</span>
													</div>
												) : (
													<button
														type="button"
														onClick={() => setAgentEngine(engine.id)}
														className="inline-flex h-9 items-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
													>
														Set as Default Engine
													</button>
												)}
												{!isDefault && isUsedByAgents && (
													<span className="text-xs text-muted-foreground">
														Used by agent config overrides
													</span>
												)}
											</div>

											{/* Engine settings */}
											<EngineSettingsFields
												engine={engine}
												value={engineSettings}
												onChange={(next) => setEngineSettings(next ?? {})}
												engineDefaults={engineDefaults}
											/>

											{/* Engine credentials */}
											{engineSecrets.length > 0 ? (
												<div className="space-y-4">
													<div>
														<h4 className="text-sm font-medium">Credentials</h4>
														<p className="text-xs text-muted-foreground mt-0.5">
															API keys and tokens for {engine.label}. Values are stored encrypted
															and never returned to the browser.
														</p>
													</div>
													{engineSecrets.map((secret) => {
														const sharedWith = sharedSecretEngines(secret.envVarKey);
														const sharedNote =
															sharedWith.length > 0
																? `Also used by: ${sharedWith.join(', ')}`
																: undefined;
														return (
															<ProjectSecretField
																key={secret.envVarKey}
																projectId={project.id}
																envVarKey={secret.envVarKey}
																label={secret.label}
																description={sharedNote ?? secret.description}
																placeholder={secret.placeholder}
																credential={credentials.find(
																	(c) => c.envVarKey === secret.envVarKey,
																)}
															/>
														);
													})}
												</div>
											) : (
												<p className="text-sm text-muted-foreground">
													No credentials required for {engine.label}.
												</p>
											)}
										</TabsContent>
									);
								})}
							</Tabs>
						)}
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
			</div>
		</TooltipProvider>
	);
}
