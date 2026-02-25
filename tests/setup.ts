import { afterEach, beforeEach } from 'vitest';
// Import configCache directly to avoid pulling in provider.js → credentialsRepository.js → client.js,
// which would pre-load real DB modules before test files can mock them.
import { configCache } from '../src/config/configCache.js';

beforeEach(() => {
	configCache.invalidate();
});

afterEach(() => {
	configCache.invalidate();
});
