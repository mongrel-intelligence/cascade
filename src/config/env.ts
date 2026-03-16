export interface EnvConfig {
	port: number;
	logLevel: string;
	databaseUrl: string;
	sentryDsn?: string;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
	return process.env[key] || defaultValue;
}

export function loadEnvConfigSafe(): Omit<EnvConfig, 'databaseUrl'> & { databaseUrl?: string } {
	return {
		port: Number.parseInt(getEnvOrDefault('PORT', '3000'), 10),
		logLevel: getEnvOrDefault('LOG_LEVEL', 'info'),
		databaseUrl: process.env.DATABASE_URL,
		sentryDsn: process.env.SENTRY_DSN,
	};
}
