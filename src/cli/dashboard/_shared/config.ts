import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CliConfig {
	serverUrl: string;
	sessionToken: string;
	cookieName?: string; // Cookie name from server (e.g., cascade_session or cascade_session_development)
	orgId?: string;
}

const CONFIG_DIR = join(homedir(), '.cascade');
const CONFIG_FILE = join(CONFIG_DIR, 'cli.json');

export function loadConfig(): CliConfig | null {
	// Env var overrides take priority
	const envUrl = process.env.CASCADE_SERVER_URL;
	const envToken = process.env.CASCADE_SESSION_TOKEN;
	const envOrgId = process.env.CASCADE_ORG_ID;
	if (envUrl && envToken) {
		return {
			serverUrl: envUrl,
			sessionToken: envToken,
			cookieName: 'cascade_session',
			orgId: envOrgId,
		};
	}

	if (!existsSync(CONFIG_FILE)) return null;

	try {
		const raw = readFileSync(CONFIG_FILE, 'utf-8');
		const parsed = JSON.parse(raw) as Partial<CliConfig>;
		if (!parsed.serverUrl || !parsed.sessionToken) return null;

		return {
			serverUrl: envUrl ?? parsed.serverUrl,
			sessionToken: envToken ?? parsed.sessionToken,
			cookieName: parsed.cookieName ?? 'cascade_session', // Default to production cookie name
			orgId: envOrgId ?? parsed.orgId,
		};
	} catch {
		return null;
	}
}

export function saveConfig(config: CliConfig): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
	writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export function clearConfig(): void {
	if (existsSync(CONFIG_FILE)) {
		writeFileSync(CONFIG_FILE, '{}', 'utf-8');
	}
}
