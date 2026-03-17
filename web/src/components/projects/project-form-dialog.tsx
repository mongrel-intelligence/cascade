import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

interface ProjectFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function ProjectFormDialog({ open, onOpenChange }: ProjectFormDialogProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState('');

	const createMutation = useMutation({
		mutationFn: (data: { id: string; name: string }) => trpcClient.projects.create.mutate(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.projects.listFull.queryOptions().queryKey });
			queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryOptions().queryKey });
			onOpenChange(false);
			resetForm();
		},
	});

	function resetForm() {
		setName('');
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		createMutation.mutate({ id: slugify(name), name });
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
					<DialogTitle>New Project</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="project-name">Name</Label>
						<Input
							id="project-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="My Project"
							required
						/>
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
							disabled={createMutation.isPending}
							className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{createMutation.isPending ? 'Creating...' : 'Create'}
						</button>
					</div>
					{createMutation.isError && (
						<p className="text-sm text-destructive">{createMutation.error.message}</p>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}
