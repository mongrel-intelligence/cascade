import { afterEach, beforeEach } from 'vitest';
import { clearConfigCache } from '../src/config/projects.js';
import { resetTrelloClient } from '../src/trello/client.js';

beforeEach(() => {
	// Reset environment
	process.env.TRELLO_API_KEY = 'test-api-key';
	process.env.TRELLO_TOKEN = 'test-token';
	process.env.GITHUB_TOKEN = 'test-github-token';
});

afterEach(() => {
	// Cleanup
	resetTrelloClient();
	clearConfigCache();
});
