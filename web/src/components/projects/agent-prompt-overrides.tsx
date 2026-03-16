import {
	PromptSectionTab,
	ValidationStatus,
} from '@/components/settings/agent-definition-prompts.js';
import { ReferencePanel } from '@/components/settings/prompt-editor.js';
/**
 * AgentPromptOverrides — project-level prompt override editor.
 * Allows admins to set system/task prompt overrides for a specific agent
 * within a project, with inheritance badges and validation support.
 */
import { Badge } from '@/components/ui/badge.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

interface AgentPromptOverridesProps {
	projectId: string;
	agentType: string;
	/** External system prompt state (controlled by parent for save) */
	systemPrompt: string;
	onSystemPromptChange: (v: string) => void;
	/** External task prompt state (controlled by parent for save) */
	taskPrompt: string;
	onTaskPromptChange: (v: string) => void;
	/**
	 * Called when the user explicitly clears the system prompt override.
	 * The parent should persist null (not the fallback text) on next save.
	 */
	onSystemPromptClear: () => void;
	/**
	 * Called when the user explicitly clears the task prompt override.
	 * The parent should persist null (not the fallback text) on next save.
	 */
	onTaskPromptClear: () => void;
}

export function AgentPromptOverrides({
	projectId,
	agentType,
	systemPrompt,
	onSystemPromptChange,
	taskPrompt,
	onTaskPromptChange,
	onSystemPromptClear,
	onTaskPromptClear,
}: AgentPromptOverridesProps) {
	const [activeSection, setActiveSection] = useState<'system' | 'task'>('system');
	const [validationStatus, setValidationStatus] = useState<string | null>(null);
	const [validationError, setValidationError] = useState<string | undefined>(undefined);

	const promptsQuery = useQuery(
		trpc.agentConfigs.getPrompts.queryOptions({ projectId, agentType }),
	);

	const systemVariablesQuery = useQuery(trpc.prompts.variables.queryOptions());
	const taskVariablesQuery = useQuery(trpc.prompts.taskVariables.queryOptions());
	const partialsQuery = useQuery(trpc.prompts.listPartials.queryOptions());

	const data = promptsQuery.data;

	// Sync prompt state with fetched data
	// biome-ignore lint/correctness/useExhaustiveDependencies: onSystemPromptChange and onTaskPromptChange are stable setters from useState
	useEffect(() => {
		if (!data) return;
		// Initialize with project override, then fall back to global, then default
		const initialSystem =
			data.projectSystemPrompt ?? data.globalSystemPrompt ?? data.defaultSystemPrompt ?? '';
		const initialTask = data.projectTaskPrompt ?? data.globalTaskPrompt ?? '';
		onSystemPromptChange(initialSystem);
		onTaskPromptChange(initialTask);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [data]);

	const validateMutation = useMutation({
		mutationFn: () =>
			trpcClient.prompts.validate.mutate({
				template: activeSection === 'system' ? systemPrompt : taskPrompt,
			}),
		onSuccess: (result) => {
			if (result.valid) {
				setValidationStatus('Valid.');
				setValidationError(undefined);
			} else {
				setValidationStatus(`Invalid: ${result.error}`);
				setValidationError(undefined);
			}
		},
		onError: (err) => {
			setValidationError(err.message);
			setValidationStatus(null);
		},
	});

	if (promptsQuery.isLoading) {
		return (
			<div className="flex items-center justify-center h-[200px]">
				<div className="text-sm text-muted-foreground">Loading prompts...</div>
			</div>
		);
	}

	if (promptsQuery.error) {
		return (
			<div className="flex items-center justify-center h-[200px]">
				<div className="text-sm text-destructive">
					Failed to load prompts: {promptsQuery.error.message}
				</div>
			</div>
		);
	}

	const isSystemSection = activeSection === 'system';
	const currentContent = isSystemSection ? systemPrompt : taskPrompt;
	const setCurrentContent = isSystemSection ? onSystemPromptChange : onTaskPromptChange;

	// Determine inheritance badge for each prompt type
	const systemBadge = getInheritanceBadge({
		projectOverride: data?.projectSystemPrompt ?? null,
		globalPrompt: data?.globalSystemPrompt ?? null,
		defaultPrompt: data?.defaultSystemPrompt ?? null,
	});
	const taskBadge = getInheritanceBadge({
		projectOverride: data?.projectTaskPrompt ?? null,
		globalPrompt: data?.globalTaskPrompt ?? null,
		defaultPrompt: null,
	});

	const currentBadge = isSystemSection ? systemBadge : taskBadge;

	const variables = isSystemSection ? systemVariablesQuery.data : taskVariablesQuery.data;

	const placeholder = isSystemSection
		? 'Enter the system prompt template with Eta variables and <%~ include("partials/...") %> directives'
		: 'Enter the task prompt template with Eta variables like <%= it.workItemId %>';

	const handleLoadDefault = () => {
		if (isSystemSection && data?.defaultSystemPrompt) {
			onSystemPromptChange(data.defaultSystemPrompt);
			setValidationStatus(null);
		} else if (!isSystemSection && data?.globalTaskPrompt) {
			onTaskPromptChange(data.globalTaskPrompt);
			setValidationStatus(null);
		}
	};

	const handleClearOverride = () => {
		if (isSystemSection) {
			// Display the inherited/default fallback text, but signal the parent
			// to send null on save so the override is truly removed (not duplicated).
			const fallback = data?.globalSystemPrompt ?? data?.defaultSystemPrompt ?? '';
			onSystemPromptChange(fallback);
			onSystemPromptClear();
		} else {
			// Display the global definition or empty, and signal parent to send null.
			const fallback = data?.globalTaskPrompt ?? '';
			onTaskPromptChange(fallback);
			onTaskPromptClear();
		}
		setValidationStatus(null);
	};

	const hasProjectSystemOverride = !!data?.projectSystemPrompt;
	const hasProjectTaskOverride = !!data?.projectTaskPrompt;

	const canLoadDefault = isSystemSection ? !!data?.defaultSystemPrompt : !!data?.globalTaskPrompt;

	return (
		<div className="space-y-4">
			{/* Section tabs */}
			<div className="flex items-center gap-4 border-b border-border">
				<PromptSectionTab
					label="System Prompt"
					isActive={activeSection === 'system'}
					hasCustom={hasProjectSystemOverride}
					onClick={() => {
						setActiveSection('system');
						setValidationStatus(null);
					}}
				/>
				<PromptSectionTab
					label="Task Prompt"
					isActive={activeSection === 'task'}
					hasCustom={hasProjectTaskOverride}
					onClick={() => {
						setActiveSection('task');
						setValidationStatus(null);
					}}
				/>
			</div>

			{/* Header with inheritance badge */}
			<div className="flex items-center gap-2">
				<span className="text-sm text-muted-foreground">
					{isSystemSection ? 'System' : 'Task'} prompt for{' '}
					<span className="font-mono font-medium">{agentType}</span>
				</span>
				<InheritanceBadge badge={currentBadge} />
			</div>

			<div className="grid grid-cols-3 gap-4">
				<div className="col-span-2 space-y-2">
					<textarea
						value={currentContent}
						onChange={(e) => {
							setCurrentContent(e.target.value);
							setValidationStatus(null);
						}}
						className="w-full h-[400px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
						spellCheck={false}
						placeholder={placeholder}
					/>
					<div className="flex items-center gap-4">
						{canLoadDefault && (
							<button
								type="button"
								onClick={handleLoadDefault}
								className="text-sm text-muted-foreground hover:text-foreground"
							>
								Load Default
							</button>
						)}
						<button
							type="button"
							onClick={handleClearOverride}
							className="text-sm text-muted-foreground hover:text-foreground"
						>
							Clear Override
						</button>
						<button
							type="button"
							onClick={() => validateMutation.mutate()}
							disabled={validateMutation.isPending}
							className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
						>
							{validateMutation.isPending ? 'Validating...' : 'Validate'}
						</button>
						<ValidationStatus status={validationStatus} saveError={validationError} />
					</div>
				</div>

				<ReferencePanel variables={variables} partials={partialsQuery.data} />
			</div>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// InheritanceBadge — shows Custom / Inherited / Default
// ─────────────────────────────────────────────────────────────────────────────

type BadgeType = 'custom' | 'inherited' | 'default';

function getInheritanceBadge({
	projectOverride,
	globalPrompt,
	defaultPrompt,
}: {
	projectOverride: string | null;
	globalPrompt: string | null;
	defaultPrompt: string | null;
}): BadgeType {
	if (projectOverride) return 'custom';
	if (globalPrompt) return 'inherited';
	return 'default';
}

function InheritanceBadge({ badge }: { badge: BadgeType }) {
	if (badge === 'custom') {
		return (
			<Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0">
				Custom
			</Badge>
		);
	}
	if (badge === 'inherited') {
		return (
			<Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-0">
				Inherited
			</Badge>
		);
	}
	return (
		<Badge className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-0">
			Default
		</Badge>
	);
}
