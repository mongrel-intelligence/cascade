import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
	Sentry.init({
		dsn: process.env.SENTRY_DSN,
		environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
		release: process.env.SENTRY_RELEASE || undefined,
		tracesSampleRate:
			process.env.SENTRY_TRACES_SAMPLE_RATE != null
				? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
				: 0.1,
		sendDefaultPii: false,
	});
}
