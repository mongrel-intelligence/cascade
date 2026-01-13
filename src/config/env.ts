export interface EnvConfig {
	port: number;
	logLevel: string;
	configPath: string;
	trelloApiKey: string;
	trelloToken: string;
	githubToken: string;
	geminiApiKey?: string;
	anthropicApiKey?: string;
	openaiApiKey?: string;
	openrouterApiKey?: string;
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
		configPath: getEnvOrDefault('CONFIG_PATH', './config/projects.json'),
		trelloApiKey: getEnvOrThrow('TRELLO_API_KEY'),
		trelloToken: getEnvOrThrow('TRELLO_TOKEN'),
		githubToken: getEnvOrThrow('GITHUB_TOKEN'),
		geminiApiKey: process.env.GEMINI_API_KEY,
		anthropicApiKey: process.env.ANTHROPIC_API_KEY,
		openaiApiKey: process.env.OPENAI_API_KEY,
		openrouterApiKey: process.env.OPENROUTER_API_KEY,
	};
}

export function loadEnvConfigSafe(): Partial<EnvConfig> {
	return {
		port: Number.parseInt(getEnvOrDefault('PORT', '3000'), 10),
		logLevel: getEnvOrDefault('LOG_LEVEL', 'info'),
		configPath: getEnvOrDefault('CONFIG_PATH', './config/projects.json'),
		trelloApiKey: process.env.TRELLO_API_KEY,
		trelloToken: process.env.TRELLO_TOKEN,
		githubToken: process.env.GITHUB_TOKEN,
		geminiApiKey: process.env.GEMINI_API_KEY,
		anthropicApiKey: process.env.ANTHROPIC_API_KEY,
		openaiApiKey: process.env.OPENAI_API_KEY,
		openrouterApiKey: process.env.OPENROUTER_API_KEY,
	};
}
