import * as Sentry from '@sentry/node';

export const sentryEnabled = !!process.env.SENTRY_DSN;

export function captureException(
	error: unknown,
	context?: {
		tags?: Record<string, string>;
		extra?: Record<string, unknown>;
		level?: Sentry.SeverityLevel;
	},
): void {
	if (!sentryEnabled) return;

	Sentry.withScope((scope) => {
		if (context?.tags) {
			for (const [key, value] of Object.entries(context.tags)) {
				scope.setTag(key, value);
			}
		}
		if (context?.extra) {
			for (const [key, value] of Object.entries(context.extra)) {
				scope.setExtra(key, value);
			}
		}
		if (context?.level) {
			scope.setLevel(context.level);
		}
		Sentry.captureException(error);
	});
}

export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
	if (!sentryEnabled) return;
	Sentry.addBreadcrumb(breadcrumb);
}

export function setTag(key: string, value: string): void {
	if (!sentryEnabled) return;
	Sentry.setTag(key, value);
}

export async function flush(timeoutMs = 2000): Promise<void> {
	if (!sentryEnabled) return;
	await Sentry.flush(timeoutMs);
}
