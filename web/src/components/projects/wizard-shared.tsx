/**
 * Shared wizard UI components used across pm-wizard, email-wizard, and twilio-wizard.
 * Extracted to eliminate ~250 lines of verbatim duplication.
 */
import { Input } from '@/components/ui/input.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface CredentialOption {
	id: number;
	name: string;
	envVarKey: string;
	value: string;
}

// ============================================================================
// WizardStep Shell
// ============================================================================

/**
 * Collapsible wizard step with a numbered circle indicator.
 *
 * The `status` prop is a superset of all three wizard usages:
 * - pm-wizard uses 'pending' | 'complete' | 'error' | 'active'
 * - email-wizard and twilio-wizard use 'pending' | 'complete' | 'active'
 */
export function WizardStep({
	stepNumber,
	title,
	status,
	isOpen,
	onToggle,
	children,
}: {
	stepNumber: number;
	title: string;
	status: 'pending' | 'complete' | 'error' | 'active';
	isOpen: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}) {
	const statusClasses =
		status === 'complete'
			? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
			: status === 'error'
				? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
				: status === 'active'
					? 'bg-primary text-primary-foreground'
					: 'bg-muted text-muted-foreground';

	return (
		<div className="border rounded-lg overflow-hidden">
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
			>
				<div
					className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${statusClasses}`}
				>
					{status === 'complete' ? <Check className="h-4 w-4" /> : stepNumber}
				</div>
				<span className="flex-1 text-sm font-medium">{title}</span>
				{isOpen ? (
					<ChevronDown className="h-4 w-4 text-muted-foreground" />
				) : (
					<ChevronRight className="h-4 w-4 text-muted-foreground" />
				)}
			</button>
			{isOpen && <div className="border-t px-4 py-4 space-y-4">{children}</div>}
		</div>
	);
}

// ============================================================================
// Inline Credential Creator
// ============================================================================

/**
 * Inline form for creating a new credential without leaving the wizard.
 * Renders as a "Create new" link that expands into a small form.
 *
 * The optional `suggestedKey` prop pre-fills the ENV_VAR_KEY input and is
 * reset on success (used by email-wizard and twilio-wizard; absent in pm-wizard).
 */
export function InlineCredentialCreator({
	onCreated,
	suggestedKey,
}: {
	onCreated: (id: number) => void;
	suggestedKey?: string;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [name, setName] = useState('');
	const [envVarKey, setEnvVarKey] = useState(suggestedKey ?? '');
	const [value, setValue] = useState('');
	const queryClient = useQueryClient();

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.credentials.create.mutate({ name, envVarKey, value, isDefault: false }),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({
				queryKey: trpc.credentials.list.queryOptions().queryKey,
			});
			onCreated((result as { id: number }).id);
			setIsOpen(false);
			setName('');
			setEnvVarKey(suggestedKey ?? '');
			setValue('');
		},
	});

	if (!isOpen) {
		return (
			<button
				type="button"
				onClick={() => setIsOpen(true)}
				className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
			>
				<Plus className="h-3 w-3" /> Create new
			</button>
		);
	}

	return (
		<div className="rounded-md border border-dashed p-3 space-y-2">
			<div className="flex gap-2">
				<Input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Name"
					className="flex-1"
				/>
				<Input
					value={envVarKey}
					onChange={(e) => setEnvVarKey(e.target.value.toUpperCase())}
					placeholder="ENV_VAR_KEY"
					className="flex-1"
				/>
			</div>
			<Input
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="Secret value"
				type="password"
			/>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => createMutation.mutate()}
					disabled={!name || !envVarKey || !value || createMutation.isPending}
					className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
				</button>
				<button
					type="button"
					onClick={() => setIsOpen(false)}
					className="inline-flex h-8 items-center rounded-md border px-3 text-xs hover:bg-accent"
				>
					Cancel
				</button>
				{createMutation.isError && (
					<span className="text-xs text-destructive self-center">
						{createMutation.error.message}
					</span>
				)}
			</div>
		</div>
	);
}
