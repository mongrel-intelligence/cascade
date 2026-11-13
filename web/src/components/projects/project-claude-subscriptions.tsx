/**
 * Claude Code subscriptions (multiple OAuth tokens) for a project.
 * Tokens are write-only: the list never returns them.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';

function UsageBar({ label, pct, resetAt }: { label: string; pct: number; resetAt: string | null }) {
	// A window whose reset time has passed no longer counts (same rule as the router).
	const expired = resetAt !== null && new Date(resetAt).getTime() <= Date.now();
	const effective = expired ? 0 : pct;
	return (
		<div className="space-y-1">
			<div className="flex justify-between text-xs text-muted-foreground">
				<span>{label}</span>
				<span>
					{effective}%{resetAt && !expired && ` · resets ${new Date(resetAt).toLocaleString()}`}
				</span>
			</div>
			<div className="h-1.5 w-full rounded bg-muted">
				<div
					className={`h-1.5 rounded ${effective >= 95 ? 'bg-destructive' : 'bg-primary'}`}
					style={{ width: `${Math.min(100, effective)}%` }}
				/>
			</div>
		</div>
	);
}

export function ProjectClaudeSubscriptions({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();
	const listOptions = trpc.subscriptions.list.queryOptions({ projectId });
	const listQuery = useQuery(listOptions);
	const [name, setName] = useState('');
	const [token, setToken] = useState('');

	const invalidate = () => queryClient.invalidateQueries({ queryKey: listOptions.queryKey });

	const createMutation = useMutation({
		mutationFn: () => trpcClient.subscriptions.create.mutate({ projectId, name, token }),
		onSuccess: () => {
			setName('');
			setToken('');
			invalidate();
		},
	});
	const toggleMutation = useMutation({
		mutationFn: (input: { id: number; enabled: boolean }) =>
			trpcClient.subscriptions.setEnabled.mutate(input),
		onSuccess: invalidate,
	});
	const deleteMutation = useMutation({
		mutationFn: (id: number) => trpcClient.subscriptions.delete.mutate({ id }),
		onSuccess: invalidate,
	});

	const subscriptions = listQuery.data ?? [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Claude subscriptions</CardTitle>
				<CardDescription>
					Several Claude Code OAuth tokens. Each run uses the subscription with the most headroom
					and switches to another when one hits its rate limit (fill-first with failover).
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-xs text-muted-foreground">
					Subscriptions are used only by agents running on the Claude Code engine. If this project
					has an ANTHROPIC_API_KEY credential (even one meant for OpenCode), subscriptions are not
					used.
				</p>

				{listQuery.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
				{listQuery.isError && <p className="text-sm text-destructive">{listQuery.error.message}</p>}
				{!listQuery.isLoading && subscriptions.length === 0 && (
					<p className="text-sm text-muted-foreground">No subscriptions configured.</p>
				)}

				{subscriptions.map((s) => (
					<div key={s.id} className="space-y-2 rounded-md border p-3">
						<div className="flex items-center gap-2">
							<span className="font-medium text-sm">{s.name}</span>
							<Badge variant={s.enabled ? 'secondary' : 'outline'} className="text-xs">
								{s.enabled ? 'enabled' : 'disabled'}
							</Badge>
							<div className="ml-auto flex items-center gap-2">
								<button
									type="button"
									onClick={() => toggleMutation.mutate({ id: s.id, enabled: !s.enabled })}
									disabled={toggleMutation.isPending}
									className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
								>
									{s.enabled ? 'Disable' : 'Enable'}
								</button>
								<button
									type="button"
									onClick={() => deleteMutation.mutate(s.id)}
									disabled={deleteMutation.isPending}
									className="p-2 text-muted-foreground hover:text-destructive disabled:opacity-50"
									title="Delete subscription"
								>
									<Trash2 className="h-4 w-4" />
								</button>
							</div>
						</div>
						<UsageBar label="5-hour" pct={s.fiveHourPct} resetAt={s.fiveHourResetAt} />
						<UsageBar label="7-day" pct={s.sevenDayPct} resetAt={s.sevenDayResetAt} />
					</div>
				))}

				<form
					className="space-y-2"
					onSubmit={(e) => {
						e.preventDefault();
						createMutation.mutate();
					}}
				>
					<Label htmlFor="subscription-name">Add subscription</Label>
					<div className="flex gap-2">
						<Input
							id="subscription-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Name"
							maxLength={50}
							className="w-40"
						/>
						<Input
							type="password"
							value={token}
							onChange={(e) => setToken(e.target.value)}
							placeholder="CLAUDE_CODE_OAUTH_TOKEN"
							autoComplete="off"
							className="flex-1"
						/>
						<button
							type="submit"
							disabled={!name || !token || createMutation.isPending}
							className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
						>
							{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
						</button>
					</div>
					{createMutation.isError && (
						<p className="text-xs text-destructive">{createMutation.error.message}</p>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
