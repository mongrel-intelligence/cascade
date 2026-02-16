import { Badge } from '@/components/ui/badge.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

export function CredentialOverrides({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();
	const overridesQuery = useQuery(
		trpc.projects.credentialOverrides.list.queryOptions({ projectId }),
	);
	const credentialsQuery = useQuery(trpc.credentials.list.queryOptions());

	const [addOpen, setAddOpen] = useState(false);
	const [envVarKey, setEnvVarKey] = useState('');
	const [credentialId, setCredentialId] = useState('');
	const [agentType, setAgentType] = useState('');

	const queryKey = trpc.projects.credentialOverrides.list.queryOptions({ projectId }).queryKey;

	const setMutation = useMutation({
		mutationFn: () => {
			if (agentType) {
				return trpcClient.projects.credentialOverrides.setAgent.mutate({
					projectId,
					envVarKey,
					agentType,
					credentialId: Number(credentialId),
				});
			}
			return trpcClient.projects.credentialOverrides.set.mutate({
				projectId,
				envVarKey,
				credentialId: Number(credentialId),
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey });
			setAddOpen(false);
			setEnvVarKey('');
			setCredentialId('');
			setAgentType('');
		},
	});

	const removeMutation = useMutation({
		mutationFn: (params: { envVarKey: string; agentType: string | null }) => {
			if (params.agentType) {
				return trpcClient.projects.credentialOverrides.removeAgent.mutate({
					projectId,
					envVarKey: params.envVarKey,
					agentType: params.agentType,
				});
			}
			return trpcClient.projects.credentialOverrides.remove.mutate({
				projectId,
				envVarKey: params.envVarKey,
			});
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey }),
	});

	if (overridesQuery.isLoading) {
		return <div className="py-4 text-muted-foreground">Loading credential overrides...</div>;
	}

	const overrides = overridesQuery.data ?? [];
	const credentials = credentialsQuery.data ?? [];

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">
					Override org-level credentials for this project.
				</p>
				<button
					type="button"
					onClick={() => setAddOpen(true)}
					className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					<Plus className="h-4 w-4" /> Add Override
				</button>
			</div>

			<div className="overflow-hidden rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Env Var Key</TableHead>
							<TableHead>Credential</TableHead>
							<TableHead>Scope</TableHead>
							<TableHead className="w-10" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{overrides.length === 0 && (
							<TableRow>
								<TableCell colSpan={4} className="text-center text-muted-foreground py-8">
									No overrides configured — using org defaults
								</TableCell>
							</TableRow>
						)}
						{overrides.map((o) => (
							<TableRow key={`${o.envVarKey}-${o.agentType ?? 'project'}`}>
								<TableCell className="font-mono text-xs">{o.envVarKey}</TableCell>
								<TableCell>{o.credentialName}</TableCell>
								<TableCell>
									{o.agentType ? (
										<Badge variant="outline">{o.agentType}</Badge>
									) : (
										<Badge variant="secondary">Project-wide</Badge>
									)}
								</TableCell>
								<TableCell>
									<button
										type="button"
										onClick={() =>
											removeMutation.mutate({
												envVarKey: o.envVarKey,
												agentType: o.agentType,
											})
										}
										className="p-1 text-muted-foreground hover:text-destructive"
									>
										<Trash2 className="h-4 w-4" />
									</button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			<Dialog open={addOpen} onOpenChange={setAddOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add Credential Override</DialogTitle>
					</DialogHeader>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							setMutation.mutate();
						}}
						className="space-y-4"
					>
						<div className="space-y-2">
							<Label htmlFor="override-key">Env Var Key</Label>
							<Input
								id="override-key"
								value={envVarKey}
								onChange={(e) => setEnvVarKey(e.target.value)}
								placeholder="GITHUB_TOKEN"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="override-cred">Credential</Label>
							<select
								id="override-cred"
								value={credentialId}
								onChange={(e) => setCredentialId(e.target.value)}
								className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
								required
							>
								<option value="">Select credential...</option>
								{credentials.map((c) => (
									<option key={c.id} value={c.id}>
										{c.name} ({c.envVarKey})
									</option>
								))}
							</select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="override-agent">Agent Type (optional)</Label>
							<Input
								id="override-agent"
								value={agentType}
								onChange={(e) => setAgentType(e.target.value)}
								placeholder="Leave empty for project-wide"
							/>
						</div>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setAddOpen(false)}
								className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm hover:bg-accent"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={setMutation.isPending}
								className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							>
								{setMutation.isPending ? 'Adding...' : 'Add Override'}
							</button>
						</div>
						{setMutation.isError && (
							<p className="text-sm text-destructive">{setMutation.error.message}</p>
						)}
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
