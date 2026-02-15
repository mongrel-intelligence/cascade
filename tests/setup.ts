import { afterEach, beforeEach } from 'vitest';
import { invalidateConfigCache } from '../src/config/provider.js';
import { resetTrelloClient } from '../src/trello/client.js';

beforeEach(() => {
	// Reset environment — only infrastructure env vars, project secrets come from DB
	process.env.TRELLO_API_KEY = 'test-api-key';
	process.env.TRELLO_TOKEN = 'test-token';
});

afterEach(() => {
	// Cleanup
	resetTrelloClient();
	invalidateConfigCache();
});
