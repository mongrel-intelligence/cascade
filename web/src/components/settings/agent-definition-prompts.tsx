/**
 * Prompts panel and related components for the agent definition editor.
 * Extracted from agent-definition-editor.tsx — handles all prompt editing
 * functionality as a self-contained module with its own queries and mutations.
 */
import { Badge } from '@/components/ui/badge.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ReferencePanel } from './prompt-editor.js';

// ─────────────────────────────────────────────────────────────────────────────
// PromptSectionTab — tab button for switching between system/task sections
// ─────────────────────────────────────────────────────────────────────────────

export function PromptSectionTab({
	label,
	isActive,
	hasCustom,
	onClick,
}: {
	label: string;
	isActive: boolean;
	hasCustom: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`pb-2 text-sm font-medium border-b-2 -mb-px ${
				isActive
					? 'border-primary text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'
			}`}
		>
			{label}
			{hasCustom && (
				<Badge variant="secondary" className="ml-2 text-xs">
					custom
				</Badge>
			)}
		</button>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// ValidationStatus — displays save/validation status messages
// ─────────────────────────────────────────────────────────────────────────────

export function ValidationStatus({
	status,
	saveError,
}: {
	status: string | null;
	saveError: string | undefined;
}) {
	if (!status && !saveError) return null;
	const isInvalid = status?.startsWith('Invalid');
	return (
		<>
			{status && (
				<span
					className={`text-sm ${isInvalid ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}
				>
					{status}
				</span>
			)}
			{saveError && <span className="text-sm text-destructive">{saveError}</span>}
		</>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// usePromptSync — syncs prompt textarea state with definition/default data
// ─────────────────────────────────────────────────────────────────────────────

export function usePromptSync(
	definition: { prompts?: { systemPrompt?: string; taskPrompt?: string } } | undefined,
	defaultContent: string | undefined,
	setSystemPrompt: (v: string) => void,
	setTaskPrompt: (v: string) => void,
) {
	useEffect(() => {
		const customSystem = definition?.prompts?.systemPrompt;
		setSystemPrompt(customSystem || defaultContent || '');
	}, [definition?.prompts?.systemPrompt, defaultContent, setSystemPrompt]);

	useEffect(() => {
		const customTask = definition?.prompts?.taskPrompt;
		if (customTask) setTaskPrompt(customTask);
	}, [definition?.prompts?.taskPrompt, setTaskPrompt]);
}

// ─────────────────────────────────────────────────────────────────────────────
// PromptEditorHeader — header bar with section label and action buttons
// ─────────────────────────────────────────────────────────────────────────────

export function PromptEditorHeader({
	sectionLabel,
	agentType,
	hasCustom,
	hasAnyCustom,
	onReset,
	onSave,
	resetPending,
	savePending,
}: {
	sectionLabel: string;
	agentType: string;
	hasCustom: boolean;
	hasAnyCustom: boolean;
	onReset: () => void;
	onSave: () => void;
	resetPending: boolean;
	savePending: boolean;
}) {
	return (
		<div className="flex items-center justify-between">
			<div className="flex items-center gap-2">
				<span className="text-sm text-muted-foreground">
					{sectionLabel} prompt for <span className="font-mono font-medium">{agentType}</span>
				</span>
				{hasCustom && <Badge>custom</Badge>}
			</div>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={onReset}
					disabled={!hasAnyCustom || resetPending}
					className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent disabled:opacity-50"
				>
					Reset All Prompts
				</button>
				<button
					type="button"
					onClick={onSave}
					disabled={savePending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{savePending ? 'Saving...' : 'Save Prompt'}
				</button>
			</div>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// PromptsPanel — main combined prompts editing panel (edit mode only)
// Shows both system and task prompts with their own queries and mutations.
// ─────────────────────────────────────────────────────────────────────────────

export function PromptsPanel({ agentType }: { agentType: string }) {
	const queryClient = useQueryClient();
	const [systemPrompt, setSystemPrompt] = useState('');
	const [taskPrompt, setTaskPrompt] = useState('');
	const [activeSection, setActiveSection] = useState<'system' | 'task'>('system');
	const [validationStatus, setValidationStatus] = useState<string | null>(null);

	const definitionQuery = useQuery(trpc.agentDefinitions.get.queryOptions({ agentType }));
	const defaultQuery = useQuery(trpc.prompts.getDefault.queryOptions({ agentType }));
	const systemVariablesQuery = useQuery(trpc.prompts.variables.queryOptions());
	const taskVariablesQuery = useQuery(trpc.prompts.taskVariables.queryOptions());
	const partialsQuery = useQuery(trpc.prompts.listPartials.queryOptions());

	const definition = definitionQuery.data?.definition;
	const hasCustomSystemPrompt = !!definition?.prompts?.systemPrompt;
	const hasCustomTaskPrompt = !!definition?.prompts?.taskPrompt;

	// Sync prompt state with definition/defaults
	usePromptSync(definition, defaultQuery.data?.content, setSystemPrompt, setTaskPrompt);

	const saveMutation = useMutation({
		mutationFn: async () => {
			// Always send both prompts to prevent losing the inactive section
			await trpcClient.agentDefinitions.updatePrompt.mutate({
				agentType,
				systemPrompt,
				taskPrompt,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.agentDefinitions.get.queryOptions({ agentType }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.agentDefinitions.list.queryOptions().queryKey,
			});
			setValidationStatus('Saved.');
		},
	});

	const resetMutation = useMutation({
		mutationFn: async () => {
			await trpcClient.agentDefinitions.resetPrompt.mutate({ agentType });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.agentDefinitions.get.queryOptions({ agentType }).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: trpc.agentDefinitions.list.queryOptions().queryKey,
			});
			if (defaultQuery.data) {
				setSystemPrompt(defaultQuery.data.content);
			}
			setTaskPrompt('');
			setValidationStatus('Reset to default.');
		},
	});

	const validateMutation = useMutation({
		mutationFn: () =>
			trpcClient.prompts.validate.mutate({
				template: activeSection === 'system' ? systemPrompt : taskPrompt,
			}),
		onSuccess: (result) => {
			if (result.valid) {
				setValidationStatus('Valid.');
			} else {
				setValidationStatus(`Invalid: ${result.error}`);
			}
		},
	});

	function loadDefaultSystemPrompt() {
		if (defaultQuery.data) {
			setSystemPrompt(defaultQuery.data.content);
			setValidationStatus(null);
		}
	}

	const isSystemSection = activeSection === 'system';
	const currentContent = isSystemSection ? systemPrompt : taskPrompt;
	const setCurrentContent = isSystemSection ? setSystemPrompt : setTaskPrompt;
	const hasCustom = isSystemSection ? hasCustomSystemPrompt : hasCustomTaskPrompt;
	const variables = isSystemSection ? systemVariablesQuery.data : taskVariablesQuery.data;
	const sectionLabel = isSystemSection ? 'System' : 'Task';
	const placeholder = isSystemSection
		? 'Enter the system prompt template with Eta variables and <%~ include("partials/...") %> directives'
		: 'Enter the task prompt template with Eta variables like <%= it.cardId %>';

	// Loading state
	const isLoading = definitionQuery.isLoading || defaultQuery.isLoading;
	// Error state
	const queryError = definitionQuery.error || defaultQuery.error;

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-[200px]">
				<div className="text-sm text-muted-foreground">Loading prompts...</div>
			</div>
		);
	}

	if (queryError) {
		return (
			<div className="flex items-center justify-center h-[200px]">
				<div className="text-sm text-destructive">Failed to load prompts: {queryError.message}</div>
			</div>
		);
	}

	const handleSectionChange = (section: 'system' | 'task') => {
		setActiveSection(section);
		setValidationStatus(null);
	};

	const handleReset = () => {
		if (!confirm('Reset both system and task prompts to their defaults?')) return;
		resetMutation.mutate();
	};

	return (
		<div className="space-y-4">
			{/* Section tabs */}
			<div className="flex items-center gap-4 border-b border-border">
				<PromptSectionTab
					label="System Prompt"
					isActive={activeSection === 'system'}
					hasCustom={hasCustomSystemPrompt}
					onClick={() => handleSectionChange('system')}
				/>
				<PromptSectionTab
					label="Task Prompt"
					isActive={activeSection === 'task'}
					hasCustom={hasCustomTaskPrompt}
					onClick={() => handleSectionChange('task')}
				/>
			</div>

			{/* Header with actions */}
			<PromptEditorHeader
				sectionLabel={sectionLabel}
				agentType={agentType}
				hasCustom={hasCustom}
				hasAnyCustom={hasCustomSystemPrompt || hasCustomTaskPrompt}
				onReset={handleReset}
				onSave={() => saveMutation.mutate()}
				resetPending={resetMutation.isPending}
				savePending={saveMutation.isPending}
			/>

			<div className="grid grid-cols-3 gap-4">
				<div className="col-span-2 space-y-2">
					<textarea
						value={currentContent}
						onChange={(e) => {
							setCurrentContent(e.target.value);
							setValidationStatus(null);
						}}
						className="w-full h-[500px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
						spellCheck={false}
						placeholder={placeholder}
					/>
					<div className="flex items-center gap-4">
						{isSystemSection && (
							<button
								type="button"
								onClick={loadDefaultSystemPrompt}
								className="text-sm text-muted-foreground hover:text-foreground"
							>
								Load Default
							</button>
						)}
						<button
							type="button"
							onClick={() => validateMutation.mutate()}
							disabled={validateMutation.isPending}
							className="text-sm text-muted-foreground hover:text-foreground"
						>
							Validate
						</button>
						<ValidationStatus
							status={validationStatus}
							saveError={saveMutation.isError ? saveMutation.error.message : undefined}
						/>
					</div>
				</div>

				<ReferencePanel variables={variables} partials={partialsQuery.data} />
			</div>
		</div>
	);
}
