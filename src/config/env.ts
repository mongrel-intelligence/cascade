export interface EnvConfig {
	port: number;
	logLevel: string;
	databaseUrl: string;
}

function getEnvOrThrow(key: string): string {
	const value = process.env[key];
	if (!value) {
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
	return process.env[key] || defaultValue;
}

export function loadEnvConfig(): EnvConfig {
	return {
		port: Number.parseInt(getEnvOrDefault('PORT', '3000'), 10),
		logLevel: getEnvOrDefault('LOG_LEVEL', 'info'),
		databaseUrl: getEnvOrThrow('DATABASE_URL'),
	};
}

export function loadEnvConfigSafe(): Partial<EnvConfig> {
	return {
		port: Number.parseInt(getEnvOrDefault('PORT', '3000'), 10),
		logLevel: getEnvOrDefault('LOG_LEVEL', 'info'),
		databaseUrl: process.env.DATABASE_URL,
	};
}
