/**
 * EmailJokeConfig — configures which emails the joke agent will respond to.
 * Completely independent of the EmailWizard; extracted for separation of concerns.
 */
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export function EmailJokeConfig({ projectId }: { projectId: string }) {
	const [senderEmail, setSenderEmail] = useState('');
	const [savedEmail, setSavedEmail] = useState<string | null>(null);
	const [initialized, setInitialized] = useState(false);
	const [emailError, setEmailError] = useState<string | null>(null);
	const queryClient = useQueryClient();

	// Fetch current triggers config
	const integrationsQuery = useQuery(trpc.projects.integrations.list.queryOptions({ projectId }));

	// Initialize from existing config (only once)
	useEffect(() => {
		if (initialized || !integrationsQuery.data) return;
		const emailIntegration = (
			integrationsQuery.data as unknown as Array<{ category: string; triggers: unknown }>
		).find((i) => i.category === 'email');
		if (emailIntegration?.triggers) {
			const t = emailIntegration.triggers as { senderEmail?: string | null };
			if (t.senderEmail) {
				setSenderEmail(t.senderEmail);
				setSavedEmail(t.senderEmail);
			}
		}
		setInitialized(true);
	}, [integrationsQuery.data, initialized]);

	// Show error state if query failed
	if (integrationsQuery.isError) {
		return (
			<div className="rounded-lg border border-destructive/50 p-4">
				<p className="text-sm text-destructive">
					Failed to load integration config: {integrationsQuery.error.message}
				</p>
			</div>
		);
	}

	const updateMutation = useMutation({
		mutationFn: async (email: string | null) => {
			await trpcClient.projects.integrations.updateTriggers.mutate({
				projectId,
				category: 'email',
				triggers: { senderEmail: email },
			});
		},
		onSuccess: () => {
			setSavedEmail(senderEmail || null);
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	const hasChanges = senderEmail !== (savedEmail ?? '');

	// Validate email format on blur
	const validateEmail = (email: string) => {
		if (!email) {
			setEmailError(null);
			return true;
		}
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			setEmailError('Please enter a valid email address');
			return false;
		}
		setEmailError(null);
		return true;
	};

	const handleSave = () => {
		if (senderEmail && !validateEmail(senderEmail)) {
			return;
		}
		updateMutation.mutate(senderEmail || null);
	};

	return (
		<div className="rounded-lg border p-4 space-y-4">
			<div>
				<h3 className="text-sm font-medium">Email Joke Agent</h3>
				<p className="text-xs text-muted-foreground mt-1">
					Configure which emails the joke agent will respond to.
				</p>
			</div>
			<div className="space-y-2">
				<Label htmlFor="sender-email-filter">Sender Email Filter</Label>
				<div className="flex gap-2">
					<Input
						id="sender-email-filter"
						type="email"
						placeholder="friend@example.com"
						value={senderEmail}
						onChange={(e) => {
							setSenderEmail(e.target.value);
							if (emailError) setEmailError(null);
						}}
						onBlur={(e) => validateEmail(e.target.value)}
						className={`flex-1 ${emailError ? 'border-destructive' : ''}`}
					/>
					<button
						type="button"
						onClick={handleSave}
						disabled={!hasChanges || updateMutation.isPending || !!emailError}
						className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
					</button>
					{savedEmail && (
						<button
							type="button"
							onClick={() => {
								setSenderEmail('');
								setEmailError(null);
								updateMutation.mutate(null);
							}}
							disabled={updateMutation.isPending}
							className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent"
						>
							Clear
						</button>
					)}
				</div>
				{emailError && <p className="text-xs text-destructive">{emailError}</p>}
				<p className="text-xs text-muted-foreground">
					{savedEmail
						? `Currently filtering emails from: ${savedEmail}`
						: 'No filter set. The agent will process all unread emails.'}
				</p>
			</div>
			{updateMutation.isSuccess && (
				<p className="text-sm text-green-600 dark:text-green-400">Configuration saved.</p>
			)}
			{updateMutation.isError && (
				<p className="text-sm text-destructive">{updateMutation.error.message}</p>
			)}
		</div>
	);
}
