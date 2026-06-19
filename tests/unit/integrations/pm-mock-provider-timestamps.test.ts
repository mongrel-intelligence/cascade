/**
 * Companion tests for the mock-provider timestamp helpers introduced in
 * MNG-1422. These guard the deterministic-fixture contract: tests that need
 * to assert provider timestamps flow through to mutation-result helpers must
 * be able to do so without timer mocking.
 */

import { describe, expect, it } from 'vitest';

import {
	createMockPMProvider,
	createMockWorkItem,
	createMockWorkItemComment,
	MOCK_PROVIDER_TIMESTAMP,
} from '../../helpers/mockPMProvider.js';

describe('mockPMProvider — deterministic timestamps (MNG-1422)', () => {
	it('MOCK_PROVIDER_TIMESTAMP is a stable ISO string', () => {
		expect(MOCK_PROVIDER_TIMESTAMP).toBe('2026-01-01T00:00:00.000Z');
		// Sanity check: parses back to a valid Date.
		expect(Number.isNaN(new Date(MOCK_PROVIDER_TIMESTAMP).getTime())).toBe(false);
	});

	it('createMockWorkItem produces a work item with stable timestamps', () => {
		const item = createMockWorkItem();
		expect(item.createdAt).toBe(MOCK_PROVIDER_TIMESTAMP);
		expect(item.updatedAt).toBe(MOCK_PROVIDER_TIMESTAMP);
	});

	it('createMockWorkItem accepts overrides', () => {
		const item = createMockWorkItem({
			id: 'custom-id',
			updatedAt: '2026-05-01T00:00:00.000Z',
		});
		expect(item.id).toBe('custom-id');
		expect(item.createdAt).toBe(MOCK_PROVIDER_TIMESTAMP); // unchanged default
		expect(item.updatedAt).toBe('2026-05-01T00:00:00.000Z');
	});

	it('createMockWorkItemComment produces a comment with stable timestamps', () => {
		const comment = createMockWorkItemComment();
		expect(comment.createdAt).toBe(MOCK_PROVIDER_TIMESTAMP);
		expect(comment.updatedAt).toBe(MOCK_PROVIDER_TIMESTAMP);
		expect(comment.date).toBe(MOCK_PROVIDER_TIMESTAMP);
	});

	it('createMockWorkItemComment accepts overrides', () => {
		const comment = createMockWorkItemComment({
			id: 'c-99',
			text: 'override text',
			updatedAt: '2026-06-01T00:00:00.000Z',
		});
		expect(comment.id).toBe('c-99');
		expect(comment.text).toBe('override text');
		expect(comment.createdAt).toBe(MOCK_PROVIDER_TIMESTAMP);
		expect(comment.updatedAt).toBe('2026-06-01T00:00:00.000Z');
	});

	it('createMockPMProvider still exposes every vi.fn() stub the prior contract listed', () => {
		const mock = createMockPMProvider();
		// Spot-check a handful of methods that pre-date MNG-1422 so the
		// timestamp addition does not silently regress the surface.
		expect(typeof mock.getWorkItem).toBe('function');
		expect(typeof mock.addComment).toBe('function');
		expect(typeof mock.moveWorkItem).toBe('function');
		expect(typeof mock.createWorkItem).toBe('function');
	});
});
