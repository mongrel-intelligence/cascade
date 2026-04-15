import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	ENV_VAR_NAME,
	clearProgressCommentId,
	readProgressCommentId,
	writeProgressCommentId,
} from '../../../src/backends/progressState.js';

describe('progressState utilities', () => {
	beforeEach(() => {
		// Ensure clean env var state before each test
		delete process.env[ENV_VAR_NAME];
	});

	afterEach(() => {
		// Clean up after each test
		delete process.env[ENV_VAR_NAME];
	});

	describe('writeProgressCommentId', () => {
		it('writes workItemId:commentId to env var', () => {
			writeProgressCommentId('card123', 'comment456');

			expect(process.env[ENV_VAR_NAME]).toBe('card123:comment456');
		});

		it('overwrites existing env var', () => {
			writeProgressCommentId('card1', 'comment1');
			writeProgressCommentId('card2', 'comment2');

			expect(process.env[ENV_VAR_NAME]).toBe('card2:comment2');
			const result = readProgressCommentId();
			expect(result).toEqual({ workItemId: 'card2', commentId: 'comment2' });
		});
	});

	describe('readProgressCommentId', () => {
		it('returns null when env var is not set', () => {
			const result = readProgressCommentId();
			expect(result).toBeNull();
		});

		it('returns workItemId and commentId from env var', () => {
			writeProgressCommentId('my-card', 'my-comment');

			const result = readProgressCommentId();
			expect(result).toEqual({ workItemId: 'my-card', commentId: 'my-comment' });
		});

		it('returns null for malformed env var (no colon)', () => {
			process.env[ENV_VAR_NAME] = 'no-colon-here';

			const result = readProgressCommentId();
			expect(result).toBeNull();
		});

		it('returns null for empty env var', () => {
			process.env[ENV_VAR_NAME] = '';

			const result = readProgressCommentId();
			expect(result).toBeNull();
		});

		it('handles commentId that contains colons (e.g. JIRA IDs)', () => {
			writeProgressCommentId('PROJ-123', 'comment:with:colons');

			const result = readProgressCommentId();
			expect(result).toEqual({ workItemId: 'PROJ-123', commentId: 'comment:with:colons' });
		});

		it('returns null when workItemId is empty', () => {
			process.env[ENV_VAR_NAME] = ':comment-only';

			const result = readProgressCommentId();
			expect(result).toBeNull();
		});

		it('returns null when commentId is empty', () => {
			process.env[ENV_VAR_NAME] = 'card-only:';

			const result = readProgressCommentId();
			expect(result).toBeNull();
		});
	});

	describe('clearProgressCommentId', () => {
		it('deletes the env var', () => {
			writeProgressCommentId('card1', 'comment1');
			expect(process.env[ENV_VAR_NAME]).toBeDefined();

			clearProgressCommentId();
			expect(process.env[ENV_VAR_NAME]).toBeUndefined();
		});

		it('does not throw when env var is not set', () => {
			expect(() => clearProgressCommentId()).not.toThrow();
		});

		it('leaves readProgressCommentId returning null after clear', () => {
			writeProgressCommentId('card1', 'comment1');
			clearProgressCommentId();

			const result = readProgressCommentId();
			expect(result).toBeNull();
		});
	});
});
