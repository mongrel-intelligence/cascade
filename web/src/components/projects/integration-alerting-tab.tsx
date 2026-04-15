/**
 * Alerting (Sentry) integration tab component.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { API_URL } from '@/lib/api.js';
import { trpc, trpcClient } from '@/lib/trpc.js';
import { CopyButton } from './integration-scm-tab.js';
import { ProjectSecretField } from './project-secret-field.js';

// ============================================================================
// Alerting Tab (Sentry)
// ============================================================================

interface AlertingTabProps {
	projectId: string;
	alertingIntegration?: Record<string, unknown>;
}

export function AlertingTab({ projectId, alertingIntegration }: AlertingTabProps) {
	const queryClient = useQueryClient();

	const existingConfig = (alertingIntegration?.config as Record<string, unknown>) ?? {};
	const [organizationSlug, setOrganizationSlug] = useState(
		(existingConfig.organizationSlug as string) ?? '',
	);

	const [verifyResult, setVerifyResult] = useState<{
		id: string;
		name: string;
		slug: string;
	} | null>(null);
	const [verifyError, setVerifyError] = useState<string | null>(null);
	const [isVerifying, setIsVerifying] = useState(false);

	const callbackBaseUrl =
		API_URL ||
		(typeof window !== 'undefined' ? window.location.origin.replace(':5173', ':3000') : '');

	const sentryWebhookUrl = callbackBaseUrl
		? `${callbackBaseUrl}/sentry/webhook/${projectId}`
		: `<YOUR_BASE_URL>/sentry/webhook/${projectId}`;

	const credentialsQuery = useQuery(trpc.projects.credentials.list.queryOptions({ projectId }));
	const credentials = credentialsQuery.data ?? [];
	const apiTokenCred = credentials.find((c) => c.envVarKey === 'SENTRY_API_TOKEN');
	const webhookSecretCred = credentials.find((c) => c.envVarKey === 'SENTRY_WEBHOOK_SECRET');

	const handleVerify = async (rawToken: string) => {
		if (!rawToken) {
			setVerifyError('Enter the API token value to verify it');
			return;
		}
		if (!organizationSlug) {
			setVerifyError('Enter the organization slug to verify it');
			return;
		}
		setIsVerifying(true);
		setVerifyError(null);
		setVerifyResult(null);
		try {
			const result = await trpcClient.integrationsDiscovery.verifySentry.mutate({
				apiToken: rawToken,
				organizationSlug,
			});
			setVerifyResult(result);
		} catch (err) {
			setVerifyError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsVerifying(false);
		}
	};

	const saveMutation = useMutation({
		mutationFn: async () => {
			return trpcClient.projects.integrations.upsert.mutate({
				projectId,
				category: 'alerting',
				provider: 'sentry',
				config: { organizationSlug },
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			return trpcClient.projects.integrations.delete.mutate({
				projectId,
				category: 'alerting',
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.integrations.list.queryOptions({ projectId }).queryKey,
			});
		},
	});

	return (
		<div className="space-y-6">
			{/* Organization Slug */}
			<div className="space-y-2">
				<Label htmlFor="sentry-org-slug">Organization Slug</Label>
				<p className="text-xs text-muted-foreground">
					Your Sentry organization slug (found in your Sentry URL:{' '}
					<code>sentry.io/organizations/&lt;slug&gt;/</code>).
				</p>
				<Input
					id="sentry-org-slug"
					value={organizationSlug}
					onChange={(e) => setOrganizationSlug(e.target.value)}
					placeholder="my-organization"
				/>
			</div>

			<hr className="border-border" />

			{/* Credentials */}
			<div className="space-y-4">
				<Label className="text-sm font-medium">Credentials</Label>
				<ProjectSecretField
					projectId={projectId}
					envVarKey="SENTRY_API_TOKEN"
					label="API Token"
					description="Sentry API token with org:read scope. Used to verify the integration and read issue details."
					placeholder="sntrys_..."
					credential={apiTokenCred}
					onVerify={handleVerify}
					isVerifying={isVerifying}
					verifyError={verifyError}
					verifiedLogin={verifyResult ? `${verifyResult.name} (${verifyResult.slug})` : null}
				/>
				<ProjectSecretField
					projectId={projectId}
					envVarKey="SENTRY_WEBHOOK_SECRET"
					label="Webhook Secret (optional)"
					description="Secret for verifying Sentry webhook payloads. Set the same value in your Sentry webhook configuration."
					placeholder="whsec_..."
					credential={webhookSecretCred}
				/>
			</div>

			<hr className="border-border" />

			{/* Sentry Webhook URL */}
			<div className="space-y-2">
				<Label>Sentry Webhook URL</Label>
				<p className="text-xs text-muted-foreground">
					Configure this URL in your Sentry project's webhook settings to receive alerts.
				</p>
				<div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
					<code className="flex-1 text-xs font-mono break-all">{sentryWebhookUrl}</code>
					<CopyButton text={sentryWebhookUrl} />
				</div>
			</div>

			<hr className="border-border" />

			{/* Save / Delete */}
			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={() => saveMutation.mutate()}
					disabled={saveMutation.isPending}
					className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{saveMutation.isPending ? 'Saving...' : 'Save Integration'}
				</button>
				{saveMutation.isSuccess && <span className="text-sm text-muted-foreground">Saved</span>}
				{saveMutation.isError && (
					<span className="text-sm text-destructive">{saveMutation.error.message}</span>
				)}
				{alertingIntegration && (
					<button
						type="button"
						onClick={() => deleteMutation.mutate()}
						disabled={deleteMutation.isPending}
						className="inline-flex h-9 items-center gap-2 rounded-md border border-destructive px-4 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
					>
						<Trash2 className="h-4 w-4" />
						{deleteMutation.isPending ? 'Deleting...' : 'Delete Integration'}
					</button>
				)}
				{deleteMutation.isError && (
					<span className="text-sm text-destructive">{deleteMutation.error.message}</span>
				)}
			</div>
		</div>
	);
}
