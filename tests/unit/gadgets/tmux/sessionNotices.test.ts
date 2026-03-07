import { afterEach, describe, expect, it } from 'vitest';
import {
	addPendingNotice,
	consumePendingSessionNotices,
} from '../../../../src/gadgets/tmux/sessionNotices.js';

describe('sessionNotices', () => {
	afterEach(() => {
		// Drain any leftover notices to keep tests isolated
		consumePendingSessionNotices();
	});

	describe('addPendingNotice', () => {
		it('stores a notice for a session key', () => {
			addPendingNotice('session-1', { exitCode: 0, tailOutput: 'done' });

			const notices = consumePendingSessionNotices();
			expect(notices.has('session-1')).toBe(true);
			expect(notices.get('session-1')).toEqual({ exitCode: 0, tailOutput: 'done' });
		});

		it('stores correct exitCode', () => {
			addPendingNotice('s', { exitCode: 42, tailOutput: '' });
			const notices = consumePendingSessionNotices();
			expect(notices.get('s')?.exitCode).toBe(42);
		});

		it('stores correct tailOutput', () => {
			addPendingNotice('s', { exitCode: 0, tailOutput: 'last 100 lines here' });
			const notices = consumePendingSessionNotices();
			expect(notices.get('s')?.tailOutput).toBe('last 100 lines here');
		});

		it('overwrites earlier notice when same session key is added twice', () => {
			addPendingNotice('dup', { exitCode: 0, tailOutput: 'first' });
			addPendingNotice('dup', { exitCode: 1, tailOutput: 'second' });

			const notices = consumePendingSessionNotices();
			expect(notices.size).toBe(1);
			expect(notices.get('dup')).toEqual({ exitCode: 1, tailOutput: 'second' });
		});
	});

	describe('consumePendingSessionNotices', () => {
		it('returns all pending notices', () => {
			addPendingNotice('a', { exitCode: 0, tailOutput: 'output-a' });
			addPendingNotice('b', { exitCode: 1, tailOutput: 'output-b' });

			const notices = consumePendingSessionNotices();
			expect(notices.size).toBe(2);
		});

		it('clears the pending notices map after consuming', () => {
			addPendingNotice('sess', { exitCode: 0, tailOutput: 'data' });

			consumePendingSessionNotices(); // first consume
			const second = consumePendingSessionNotices(); // should be empty now
			expect(second.size).toBe(0);
		});

		it('returns empty map when no notices are pending', () => {
			const notices = consumePendingSessionNotices();
			expect(notices.size).toBe(0);
		});

		it('returns a Map instance', () => {
			const notices = consumePendingSessionNotices();
			expect(notices).toBeInstanceOf(Map);
		});
	});

	describe('add/consume cycle with multiple sessions', () => {
		it('tracks multiple sessions independently', () => {
			addPendingNotice('worker-1', { exitCode: 0, tailOutput: 'success' });
			addPendingNotice('worker-2', { exitCode: 1, tailOutput: 'error' });
			addPendingNotice('worker-3', { exitCode: 0, tailOutput: 'ok' });

			const notices = consumePendingSessionNotices();
			expect(notices.size).toBe(3);
			expect(notices.get('worker-1')).toEqual({ exitCode: 0, tailOutput: 'success' });
			expect(notices.get('worker-2')).toEqual({ exitCode: 1, tailOutput: 'error' });
			expect(notices.get('worker-3')).toEqual({ exitCode: 0, tailOutput: 'ok' });
		});

		it('second consume returns empty map after multiple sessions were consumed', () => {
			addPendingNotice('a', { exitCode: 0, tailOutput: 'output-a' });
			addPendingNotice('b', { exitCode: 0, tailOutput: 'output-b' });

			consumePendingSessionNotices();
			const second = consumePendingSessionNotices();
			expect(second.size).toBe(0);
		});

		it('returned map is a snapshot (independent of internal state)', () => {
			addPendingNotice('snap', { exitCode: 0, tailOutput: 'data' });

			const notices = consumePendingSessionNotices();
			// Add another notice after consuming — it should not appear in the snapshot
			addPendingNotice('snap2', { exitCode: 1, tailOutput: 'later' });

			expect(notices.size).toBe(1);
			expect(notices.has('snap2')).toBe(false);
		});
	});
});
