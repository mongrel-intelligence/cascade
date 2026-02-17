import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

interface Credential {
	id: number;
	name: string;
	envVarKey: string;
	description: string | null;
	isDefault: boolean;
}

interface CredentialFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	credential?: Credential;
}

export function CredentialFormDialog({
	open,
	onOpenChange,
	credential,
}: CredentialFormDialogProps) {
	const queryClient = useQueryClient();
	const isEdit = !!credential;

	const [name, setName] = useState(credential?.name ?? '');
	const [envVarKey, setEnvVarKey] = useState(credential?.envVarKey ?? '');
	const [value, setValue] = useState('');
	const [description, setDescription] = useState(credential?.description ?? '');
	const [isDefault, setIsDefault] = useState(credential?.isDefault ?? false);

	const queryKey = trpc.credentials.list.queryOptions().queryKey;

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.credentials.create.mutate({
				name,
				envVarKey,
				value,
				description: description || undefined,
				isDefault,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
			onOpenChange(false);
		},
	});

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.credentials.update.mutate({
				id: credential?.id as number,
				name,
				...(value ? { value } : {}),
				description: description || undefined,
				isDefault,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
			onOpenChange(false);
		},
	});

	const activeMutation = isEdit ? updateMutation : createMutation;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{isEdit ? 'Edit Credential' : 'New Credential'}</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						activeMutation.mutate();
					}}
					className="space-y-4"
				>
					<div className="space-y-2">
						<Label htmlFor="cred-name">Name</Label>
						<Input
							id="cred-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. GitHub PAT (production)"
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="cred-key">Env Var Key</Label>
						<Input
							id="cred-key"
							value={envVarKey}
							onChange={(e) => setEnvVarKey(e.target.value.toUpperCase())}
							placeholder="e.g. GITHUB_TOKEN_IMPLEMENTER"
							pattern="^[A-Z_][A-Z0-9_]*$"
							required
							disabled={isEdit}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="cred-value">Value</Label>
						<Input
							id="cred-value"
							type="password"
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder={isEdit ? 'Enter new value to change' : 'Secret value'}
							required={!isEdit}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="cred-desc">Description</Label>
						<Input
							id="cred-desc"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Optional description"
						/>
					</div>
					<div className="flex items-center gap-2">
						<input
							id="cred-default"
							type="checkbox"
							checked={isDefault}
							onChange={(e) => setIsDefault(e.target.checked)}
							className="h-4 w-4 rounded border-input"
						/>
						<Label htmlFor="cred-default">Set as default for this env var key</Label>
					</div>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={activeMutation.isPending}
							className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{activeMutation.isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
						</button>
					</div>
					{activeMutation.isError && (
						<p className="text-sm text-destructive">{activeMutation.error.message}</p>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}
