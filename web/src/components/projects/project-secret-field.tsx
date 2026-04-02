/**
 * Reusable project-scoped secret input field.
 * Write-only — shows masked metadata when configured, never exposes plaintext.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Loader2, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

export interface ProjectCredentialMeta {
	envVarKey: string;
	name: string | null;
	isConfigured: boolean;
	maskedValue: string;
}

/**
 * A project-scoped secret input that:
 * - Shows a "Configured" badge with masked last-4 chars when set
 * - Provides a write-only input to update the value
 * - Includes a "Clear" button to delete the credential
 * - Never shows the plaintext value
 * - Optionally supports inline verification via `onVerify` / `verifiedLogin` / `isVerifying` / `verifyError`
 */
export function ProjectSecretField({
	projectId,
	envVarKey,
	label,
	description,
	placeholder,
	credential,
	onSaved,
	onCleared,
	verifiedLogin,
	onVerify,
	isVerifying,
	verifyError,
}: {
	projectId: string;
	envVarKey: string;
	label: string;
	description?: string;
	placeholder?: string;
	credential?: ProjectCredentialMeta;
	onSaved?: () => void;
	onCleared?: () => void;
	verifiedLogin?: string | null;
	onVerify?: (rawValue: string) => void;
	isVerifying?: boolean;
	verifyError?: string | null;
}) {
	const [value, setValue] = useState('');
	const [savedFeedback, setSavedFeedback] = useState(false);
	const queryClient = useQueryClient();

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.projects.credentials.list.queryOptions({ projectId }).queryKey,
		});

	const saveMutation = useMutation({
		mutationFn: () =>
			trpcClient.projects.credentials.set.mutate({
				projectId,
				envVarKey,
				value,
				name: label,
			}),
		onSuccess: () => {
			setValue('');
			setSavedFeedback(true);
			setTimeout(() => setSavedFeedback(false), 3000);
			invalidate();
			onSaved?.();
		},
	});

	const deleteMutation = useMutation({
		mutationFn: () => trpcClient.projects.credentials.delete.mutate({ projectId, envVarKey }),
		onSuccess: () => {
			invalidate();
			onCleared?.();
		},
	});

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Label htmlFor={`secret-${envVarKey}`}>{label}</Label>
				{credential?.isConfigured ? (
					<Badge variant="secondary" className="text-xs font-mono">
						{credential.maskedValue}
					</Badge>
				) : (
					<Badge variant="outline" className="text-xs text-muted-foreground border-dashed">
						not configured
					</Badge>
				)}
			</div>
			{description && <p className="text-xs text-muted-foreground">{description}</p>}
			<div className="flex gap-2">
				<Input
					id={`secret-${envVarKey}`}
					type="password"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder={credential?.isConfigured ? 'Enter new value to update...' : placeholder}
					autoComplete="off"
					className="flex-1"
				/>
				<button
					type="button"
					onClick={() => saveMutation.mutate()}
					disabled={!value || saveMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
				>
					{saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
				</button>
				{onVerify && (
					<button
						type="button"
						onClick={() => onVerify(value || '')}
						disabled={(!value && !credential?.isConfigured) || isVerifying}
						className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent disabled:opacity-50 shrink-0"
					>
						{isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
					</button>
				)}
				{credential?.isConfigured && (
					<button
						type="button"
						onClick={() => deleteMutation.mutate()}
						disabled={deleteMutation.isPending}
						className="p-2 text-muted-foreground hover:text-destructive disabled:opacity-50 shrink-0"
						title="Clear credential"
					>
						{deleteMutation.isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Trash2 className="h-4 w-4" />
						)}
					</button>
				)}
			</div>
			{saveMutation.isError && (
				<p className="text-xs text-destructive">{saveMutation.error.message}</p>
			)}
			{savedFeedback && (
				<div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
					<CheckCircle className="h-3.5 w-3.5" />
					Saved
				</div>
			)}
			{verifiedLogin && (
				<div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
					<CheckCircle className="h-4 w-4" />
					Resolved: <span className="font-medium">{verifiedLogin}</span>
				</div>
			)}
			{verifyError && (
				<div className="flex items-center gap-1.5 text-sm text-destructive">
					<XCircle className="h-4 w-4" />
					{verifyError}
				</div>
			)}
		</div>
	);
}
