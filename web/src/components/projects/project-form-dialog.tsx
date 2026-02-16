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
	const [id, setId] = useState('');
	const [idManual, setIdManual] = useState(false);
	const [repo, setRepo] = useState('');
	const [baseBranch, setBaseBranch] = useState('main');

	const createMutation = useMutation({
		mutationFn: (data: { id: string; name: string; repo: string; baseBranch: string }) =>
			trpcClient.projects.create.mutate(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.projects.listFull.queryOptions().queryKey });
			queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryOptions().queryKey });
			onOpenChange(false);
			resetForm();
		},
	});

	function resetForm() {
		setName('');
		setId('');
		setIdManual(false);
		setRepo('');
		setBaseBranch('main');
	}

	function handleNameChange(value: string) {
		setName(value);
		if (!idManual) {
			setId(slugify(value));
		}
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		createMutation.mutate({ id, name, repo, baseBranch });
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
							onChange={(e) => handleNameChange(e.target.value)}
							placeholder="My Project"
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="project-id">ID (slug)</Label>
						<Input
							id="project-id"
							value={id}
							onChange={(e) => {
								setId(e.target.value);
								setIdManual(true);
							}}
							placeholder="my-project"
							pattern="^[a-z0-9-]+$"
							required
						/>
						<p className="text-xs text-muted-foreground">
							Lowercase letters, numbers, and hyphens only.
						</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor="project-repo">Repository</Label>
						<Input
							id="project-repo"
							value={repo}
							onChange={(e) => setRepo(e.target.value)}
							placeholder="owner/repo"
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="project-branch">Base Branch</Label>
						<Input
							id="project-branch"
							value={baseBranch}
							onChange={(e) => setBaseBranch(e.target.value)}
							placeholder="main"
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
