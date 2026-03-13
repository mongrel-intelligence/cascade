import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

interface OrganizationFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organization?: { id: string; name: string } | null;
}

export function OrganizationFormDialog({
	open,
	onOpenChange,
	organization,
}: OrganizationFormDialogProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState('');
	const [id, setId] = useState('');
	const [idManual, setIdManual] = useState(false);

	useEffect(() => {
		if (organization) {
			setName(organization.name);
			setId(organization.id);
			setIdManual(true);
		} else {
			resetForm();
		}
	}, [organization]);

	const mutation = useMutation({
		mutationFn: (data: { id: string; name: string }) => {
			if (organization) {
				return trpcClient.organization.updateById.mutate(data);
			}
			return trpcClient.organization.create.mutate(data);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.organization.list.queryOptions().queryKey });
			if (organization) {
				queryClient.invalidateQueries({
					queryKey: trpc.organization.get.queryOptions().queryKey,
				});
			}
			onOpenChange(false);
			resetForm();
		},
	});

	function resetForm() {
		setName('');
		setId('');
		setIdManual(false);
	}

	function handleNameChange(value: string) {
		setName(value);
		if (!idManual && !organization) {
			setId(slugify(value));
		}
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		mutation.mutate({ id, name });
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				onOpenChange(v);
				if (!v) resetForm();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{organization ? 'Edit Organization' : 'New Organization'}</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="org-name">Name</Label>
						<Input
							id="org-name"
							value={name}
							onChange={(e) => handleNameChange(e.target.value)}
							placeholder="My Organization"
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="org-id">ID (slug)</Label>
						<Input
							id="org-id"
							value={id}
							onChange={(e) => {
								setId(e.target.value);
								setIdManual(true);
							}}
							placeholder="my-org"
							pattern="^[a-z0-9-]+$"
							required
							disabled={!!organization}
						/>
						{!organization && (
							<p className="text-xs text-muted-foreground">
								Lowercase letters, numbers, and hyphens only.
							</p>
						)}
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
							disabled={mutation.isPending}
							className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{mutation.isPending ? 'Saving...' : organization ? 'Save' : 'Create'}
						</button>
					</div>
					{mutation.isError && <p className="text-sm text-destructive">{mutation.error.message}</p>}
				</form>
			</DialogContent>
		</Dialog>
	);
}
