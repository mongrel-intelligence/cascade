import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	clearProgressCommentId,
	readProgressCommentId,
	writeProgressCommentId,
} from '../../../src/backends/progressState.js';

const STATE_FILE_NAME = '.cascade-progress-comment-id';

describe('progressState utilities', () => {
	let tmpDir: string;
	let origCwd: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `cascade-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		origCwd = process.cwd();
		process.chdir(tmpDir);
	});

	afterEach(() => {
		process.chdir(origCwd);
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe('writeProgressCommentId', () => {
		it('writes workItemId:commentId to state file in repoDir', () => {
			writeProgressCommentId(tmpDir, 'card123', 'comment456');

			const stateFile = join(tmpDir, STATE_FILE_NAME);
			expect(existsSync(stateFile)).toBe(true);

			const content = require('node:fs').readFileSync(stateFile, 'utf-8');
			expect(content).toBe('card123:comment456');
		});

		it('overwrites existing state file', () => {
			writeProgressCommentId(tmpDir, 'card1', 'comment1');
			writeProgressCommentId(tmpDir, 'card2', 'comment2');

			const result = readProgressCommentId();
			expect(result).toEqual({ workItemId: 'card2', commentId: 'comment2' });
		});
	});

	describe('readProgressCommentId', () => {
		it('returns null when state file does not exist', () => {
			const result = readProgressCommentId();
			expect(result).toBeNull();
		});

		it('returns workItemId and commentId from state file in cwd', () => {
			writeProgressCommentId(tmpDir, 'my-card', 'my-comment');

			const result = readProgressCommentId();
			expect(result).toEqual({ workItemId: 'my-card', commentId: 'my-comment' });
		});

		it('returns null for malformed state file (no colon)', () => {
			require('node:fs').writeFileSync(join(tmpDir, STATE_FILE_NAME), 'no-colon-here', 'utf-8');

			const result = readProgressCommentId();
			expect(result).toBeNull();
		});

		it('returns null for empty state file', () => {
			require('node:fs').writeFileSync(join(tmpDir, STATE_FILE_NAME), '', 'utf-8');

			const result = readProgressCommentId();
			expect(result).toBeNull();
		});

		it('handles commentId that contains colons (e.g. JIRA IDs)', () => {
			writeProgressCommentId(tmpDir, 'PROJ-123', 'comment:with:colons');

			const result = readProgressCommentId();
			expect(result).toEqual({ workItemId: 'PROJ-123', commentId: 'comment:with:colons' });
		});
	});

	describe('clearProgressCommentId', () => {
		it('deletes state file from repoDir', () => {
			writeProgressCommentId(tmpDir, 'card1', 'comment1');
			expect(existsSync(join(tmpDir, STATE_FILE_NAME))).toBe(true);

			clearProgressCommentId(tmpDir);
			expect(existsSync(join(tmpDir, STATE_FILE_NAME))).toBe(false);
		});

		it('deletes state file from cwd when no repoDir provided', () => {
			writeProgressCommentId(tmpDir, 'card1', 'comment1');
			expect(existsSync(join(tmpDir, STATE_FILE_NAME))).toBe(true);

			clearProgressCommentId();
			expect(existsSync(join(tmpDir, STATE_FILE_NAME))).toBe(false);
		});

		it('does not throw when state file does not exist', () => {
			expect(() => clearProgressCommentId(tmpDir)).not.toThrow();
		});

		it('leaves readProgressCommentId returning null after clear', () => {
			writeProgressCommentId(tmpDir, 'card1', 'comment1');
			clearProgressCommentId(tmpDir);

			const result = readProgressCommentId();
			expect(result).toBeNull();
		});
	});
});
