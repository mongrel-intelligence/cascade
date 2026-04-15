import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export function OrgForm() {
	const queryClient = useQueryClient();
	const orgQuery = useQuery(trpc.organization.get.queryOptions());
	const [name, setName] = useState('');

	useEffect(() => {
		if (orgQuery.data) {
			setName(orgQuery.data.name);
		}
	}, [orgQuery.data]);

	const updateMutation = useMutation({
		mutationFn: (data: { name: string }) => trpcClient.organization.update.mutate(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.organization.get.queryOptions().queryKey });
		},
	});

	if (orgQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading...</div>;
	}

	if (!orgQuery.data) {
		return <div className="py-4 text-muted-foreground">Organization not found</div>;
	}

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				updateMutation.mutate({ name });
			}}
			className="max-w-md space-y-4"
		>
			<div className="space-y-2">
				<Label htmlFor="org-name">Organization Name</Label>
				<Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} required />
			</div>
			<div className="flex items-center gap-2">
				<button
					type="submit"
					disabled={updateMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{updateMutation.isPending ? 'Saving...' : 'Save'}
				</button>
				{updateMutation.isSuccess && <span className="text-sm text-muted-foreground">Saved</span>}
				{updateMutation.isError && (
					<span className="text-sm text-destructive">{updateMutation.error.message}</span>
				)}
			</div>
		</form>
	);
}
