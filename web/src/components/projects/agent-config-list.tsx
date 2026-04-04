/**
 * Agent list view components: AgentRow and AgentListView.
 * Renders the table of configured agents and the list of available agents to enable.
 */
import { AlertTriangle, ChevronRight, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog.js';
import { Badge } from '@/components/ui/badge.js';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table.js';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip.js';
import { AGENT_LABELS } from '@/lib/trigger-agent-mapping.js';
import type { AgentListViewProps, AgentRowProps } from './agent-config-types.js';
import { countActiveTriggers, engineHasCredentials } from './agent-config-utils.js';

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: table row with multiple computed display values (model, engine, trigger count) and layered inheritance fallbacks
export function AgentRow({
	type,
	config,
	triggers,
	integrations,
	onSelect,
	onDeleteRequest,
	projectModel,
	projectEngine,
	systemDefaults,
	configuredCredentialKeys,
}: AgentRowProps) {
	const label = (AGENT_LABELS as Record<string, string | undefined>)[type] ?? type;
	const activeTriggerCount = countActiveTriggers(triggers, integrations);
	const modelInfo = config?.model ?? null;
	const engineInfo = config?.agentEngine ?? null;
	const hasCustomEngineSettings =
		config?.agentEngineSettings != null && Object.keys(config.agentEngineSettings).length > 0;

	// Fallback display: show inherited model/engine when agent has no specific override
	const inheritedModel = projectModel ?? systemDefaults?.model ?? null;
	const inheritedEngine = projectEngine ?? systemDefaults?.agentEngine ?? null;
	const displayModel = modelInfo ?? (inheritedModel ? `${inheritedModel} (inherited)` : null);
	const displayEngine = engineInfo ?? (inheritedEngine ? `${inheritedEngine} (inherited)` : null);

	// Check if the agent's effective engine has credentials configured
	// Only check when there is an explicit agent-level engine override
	const agentEngineId = config?.agentEngine ?? null;
	const hasMissingCredentials =
		agentEngineId !== null && !engineHasCredentials(agentEngineId, configuredCredentialKeys);

	return (
		<TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => onSelect(type)}>
			<TableCell className="font-medium">{label}</TableCell>
			<TableCell>
				{activeTriggerCount === 0 ? (
					<Badge
						variant="outline"
						className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800"
					>
						Inactive
					</Badge>
				) : config ? (
					<div className="flex items-center gap-1.5">
						<Badge variant="default" className="text-xs">
							Configured
						</Badge>
						{hasMissingCredentials && (
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
										<AlertTriangle className="h-3 w-3" />
										Missing credentials
									</span>
								</TooltipTrigger>
								<TooltipContent>
									This agent uses the {agentEngineId} engine but no credentials are configured for
									it. Configure credentials on the Harness tab.
								</TooltipContent>
							</Tooltip>
						)}
					</div>
				) : (
					<Badge variant="outline" className="text-xs">
						Default
					</Badge>
				)}
			</TableCell>
			<TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
				{displayModel || displayEngine ? (
					<span>
						{displayEngine && <span>{displayEngine}</span>}
						{displayEngine && displayModel && <span> · </span>}
						{displayModel && <span>{displayModel}</span>}
						{hasCustomEngineSettings && (
							<span className="ml-1.5 inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-xs">
								Custom settings
							</span>
						)}
					</span>
				) : (
					<span>—</span>
				)}
			</TableCell>
			<TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
				{activeTriggerCount > 0 ? (
					<span>{activeTriggerCount} active</span>
				) : (
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="inline-flex items-center gap-1">
								<AlertTriangle
									className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400"
									aria-label="Warning: no active triggers"
								/>
								<span className="text-amber-600 dark:text-amber-400 font-medium">None</span>
							</span>
						</TooltipTrigger>
						<TooltipContent>
							No triggers configured — this agent won't process any events
						</TooltipContent>
					</Tooltip>
				)}
			</TableCell>
			<TableCell>
				<div className="flex items-center justify-end gap-1">
					{config && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onDeleteRequest(config.id, label);
							}}
							className="p-1 text-muted-foreground hover:text-destructive"
							title="Delete config"
						>
							<Trash2 className="h-4 w-4" />
						</button>
					)}
					<ChevronRight className="h-4 w-4 text-muted-foreground" />
				</div>
			</TableCell>
		</TableRow>
	);
}

export function AgentListView({
	enabledAgentTypes,
	availableAgentTypes,
	configByAgent,
	triggersByAgent,
	integrations,
	onSelect,
	onDelete,
	onEnable,
	isDeleting,
	isEnabling,
	projectModel,
	projectEngine,
	systemDefaults,
	configuredCredentialKeys,
}: AgentListViewProps) {
	const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);

	return (
		<>
			{enabledAgentTypes.length === 0 ? (
				<div className="rounded-lg border border-border py-8 text-center text-muted-foreground">
					No agents enabled. Enable agents below to start processing.
				</div>
			) : (
				<div className="overflow-x-auto rounded-lg border border-border">
					<TooltipProvider delayDuration={200}>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Agent</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="hidden sm:table-cell">Engine / Model</TableHead>
									<TableHead className="hidden sm:table-cell">Active Triggers</TableHead>
									<TableHead className="w-20" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{enabledAgentTypes.map((type) => (
									<AgentRow
										key={type}
										type={type}
										config={configByAgent.get(type) ?? null}
										triggers={triggersByAgent.get(type) ?? []}
										integrations={integrations}
										onSelect={onSelect}
										onDeleteRequest={(id, label) => setDeleteTarget({ id, label })}
										projectModel={projectModel}
										projectEngine={projectEngine}
										systemDefaults={systemDefaults}
										configuredCredentialKeys={configuredCredentialKeys}
									/>
								))}
							</TableBody>
						</Table>
					</TooltipProvider>
				</div>
			)}

			{availableAgentTypes.length > 0 && (
				<div className="space-y-3">
					<p className="text-sm font-medium text-muted-foreground">Available Agents</p>
					<div className="rounded-lg border border-border divide-y divide-border">
						{availableAgentTypes.map((agentType) => {
							const label =
								(AGENT_LABELS as Record<string, string | undefined>)[agentType] ?? agentType;
							return (
								<div key={agentType} className="flex items-center justify-between px-4 py-3">
									<span className="text-sm font-medium">{label}</span>
									<button
										type="button"
										onClick={() => onEnable(agentType)}
										disabled={isEnabling}
										className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
									>
										{isEnabling ? 'Enabling...' : 'Enable Agent'}
									</button>
								</div>
							);
						})}
					</div>
				</div>
			)}

			<AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Agent Config</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the config for <strong>{deleteTarget?.label}</strong>?
							The agent will be disabled and no longer process any events. This action cannot be
							undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (deleteTarget) {
									onDelete(deleteTarget.id);
									setDeleteTarget(null);
								}
							}}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{isDeleting ? 'Deleting...' : 'Delete'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
