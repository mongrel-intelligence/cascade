import { useQuery } from '@tanstack/react-query';
import { HelpCircle } from 'lucide-react';
import { useState } from 'react';
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.js';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip.js';
import { trpc } from '@/lib/trpc.js';

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

	// Controlled active tab — null means "follow effectiveEngineId reactively" (handles async defaultsQuery)
	const [activeTab, setActiveTab] = useState<string | null>(null);
	const currentTab = activeTab ?? effectiveEngineId;

	// Resolved engine defaults for EngineSettingsFields
	function getEngineDefaults(engineId: string): Record<string, unknown> | undefined {
		return defaults
			? (defaults.engineSettings as Record<string, Record<string, unknown>>)[engineId]
			: undefined;
	}

	function handleEngineSelectChange(value: string) {
		const newEngine = value === '_system' ? '' : value;
		setAgentEngine(newEngine);
		// Switch active tab to the newly selected default engine
		const newEffective = newEngine || systemDefaultEngineId;
		setActiveTab(newEffective);
	}

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

				<Card>
					<CardHeader>
						<CardTitle>Engine</CardTitle>
						<CardDescription>
							Choose the default engine, then configure its model, settings, and credentials.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit} id="engine-config-form" className="space-y-6">
							{/* Default Engine Selector */}
							<div className="space-y-2">
								<Label htmlFor="default-engine">Default Engine</Label>
								{engines.length === 0 ? (
									<p className="text-sm text-muted-foreground">Loading engines…</p>
								) : (
									<Select value={agentEngine || '_system'} onValueChange={handleEngineSelectChange}>
										<SelectTrigger id="default-engine" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="_system">
												System Default ({capitalize(systemDefaultEngineId)})
											</SelectItem>
											{engines.map((engine) => (
												<SelectItem key={engine.id} value={engine.id}>
													{engine.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								)}
								<p className="text-xs text-muted-foreground">
									Used by all agents unless overridden per-agent.
								</p>
							</div>

							{/* Per-engine configuration tabs */}
							{engines.length > 0 && (
								<Tabs value={currentTab} onValueChange={setActiveTab}>
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
										const engineSecrets = ENGINE_SECRETS.filter((s) =>
											s.engines?.includes(engine.id),
										);
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

												{/* Model — only shown for the default engine (project-level setting) */}
												{isDefault && (
													<div className="space-y-2">
														<div className="flex items-center gap-1.5">
															<Label htmlFor={`model-${engine.id}`}>Model</Label>
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
															id={`model-${engine.id}`}
															value={model}
															onChange={setModel}
															engine={engine.id}
															defaultLabel={defaults ? defaults.model : undefined}
															projectId={project.id}
														/>
														<p className="text-xs text-muted-foreground">
															Project default. Per-agent overrides in the Agents tab.
														</p>
													</div>
												)}

												{/* Engine Settings */}
												<EngineSettingsFields
													engine={engine}
													value={engineSettings}
													onChange={(next) => setEngineSettings(next ?? {})}
													engineDefaults={engineDefaults}
												/>

												{/* Max Iterations — only shown for the default engine (project-level setting) */}
												{isDefault && (
													<div className="space-y-2">
														<div className="flex items-center gap-1.5">
															<Label htmlFor={`maxIterations-${engine.id}`}>Max Iterations</Label>
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
															id={`maxIterations-${engine.id}`}
															type="number"
															min="1"
															step="1"
															className="w-32"
															value={maxIterations}
															onChange={(e) => setMaxIterations(e.target.value)}
															placeholder={
																defaults ? `${defaults.maxIterations} (default)` : 'e.g. 50'
															}
														/>
														<p className="text-xs text-muted-foreground">
															Safety limit on tool-call iterations per run.
														</p>
													</div>
												)}

												{/* Credentials */}
												{engineSecrets.length > 0 ? (
													<div className="space-y-4">
														<div>
															<p className="text-sm font-medium">Credentials</p>
															<p className="text-xs text-muted-foreground mt-0.5">
																API keys and tokens for {engine.label}. Values are stored encrypted
																and never returned to the browser.
															</p>
														</div>
														{engineSecrets.map((secret) => {
															const sharedWith = sharedSecretEngines(secret.envVarKey);
															const sharedNote =
																sharedWith.length > 0
																	? `Also used by: ${sharedWith.map((id) => engines.find((e) => e.id === id)?.label ?? id).join(', ')}`
																	: undefined;
															const description =
																secret.description + (sharedNote ? ` · ${sharedNote}` : '');
															return (
																<ProjectSecretField
																	key={secret.envVarKey}
																	projectId={project.id}
																	envVarKey={secret.envVarKey}
																	label={secret.label}
																	description={description}
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
						</form>
					</CardContent>
					<CardFooter>
						<div className="flex items-center gap-2">
							<button
								type="submit"
								form="engine-config-form"
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
