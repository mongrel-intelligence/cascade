import { describe, expect, it, vi } from 'vitest';
import { getPMProvider, getPMProviderOrNull, withPMProvider } from '../../../src/pm/context.js';
import type { PMProvider } from '../../../src/pm/types.js';

describe('pm/context', () => {
	// Create a minimal mock provider for testing
	const createMockProvider = (): PMProvider => ({
		type: 'trello',
		addLabel: vi.fn(),
		removeLabel: vi.fn(),
		moveWorkItem: vi.fn(),
		addComment: vi.fn(),
		getWorkItem: vi.fn(),
		getWorkItemComments: vi.fn(),
		updateWorkItem: vi.fn(),
		createWorkItem: vi.fn(),
		listWorkItems: vi.fn(),
		getChecklists: vi.fn(),
		createChecklist: vi.fn(),
		addChecklistItem: vi.fn(),
		updateChecklistItem: vi.fn(),
		getAttachments: vi.fn(),
		addAttachment: vi.fn(),
		addAttachmentFile: vi.fn(),
		getCustomFieldNumber: vi.fn(),
		updateCustomFieldNumber: vi.fn(),
		getWorkItemUrl: vi.fn(),
		getAuthenticatedUser: vi.fn(),
	});

	describe('withPMProvider', () => {
		it('makes provider available within the async context', async () => {
			const provider = createMockProvider();

			await withPMProvider(provider, async () => {
				const retrieved = getPMProvider();
				expect(retrieved).toBe(provider);
			});
		});

		it('isolates provider scope between concurrent calls', async () => {
			const provider1 = createMockProvider();
			const provider2 = createMockProvider();

			// Run two contexts concurrently
			const [result1, result2] = await Promise.all([
				withPMProvider(provider1, async () => {
					// Simulate async work
					await new Promise((resolve) => setTimeout(resolve, 10));
					return getPMProvider();
				}),
				withPMProvider(provider2, async () => {
					// Simulate async work
					await new Promise((resolve) => setTimeout(resolve, 5));
					return getPMProvider();
				}),
			]);

			// Each context should see its own provider
			expect(result1).toBe(provider1);
			expect(result2).toBe(provider2);
		});

		it('removes provider from context after callback completes', async () => {
			const provider = createMockProvider();

			await withPMProvider(provider, async () => {
				expect(getPMProvider()).toBe(provider);
			});

			// Provider should not be available outside the context
			expect(() => getPMProvider()).toThrow();
		});

		it('propagates errors from callback', async () => {
			const provider = createMockProvider();
			const error = new Error('Callback failed');

			await expect(
				withPMProvider(provider, async () => {
					throw error;
				}),
			).rejects.toThrow('Callback failed');
		});

		it('returns the callback result', async () => {
			const provider = createMockProvider();

			const result = await withPMProvider(provider, async () => {
				return { success: true, data: 'test' };
			});

			expect(result).toEqual({ success: true, data: 'test' });
		});
	});

	describe('getPMProvider', () => {
		it('returns provider when in context', async () => {
			const provider = createMockProvider();

			await withPMProvider(provider, async () => {
				const retrieved = getPMProvider();
				expect(retrieved).toBe(provider);
			});
		});

		it('throws error when not in context', () => {
			expect(() => getPMProvider()).toThrow(
				'No PMProvider in scope. Wrap the call with withPMProvider() or ensure the webhook handler has established a PM context.',
			);
		});

		it('throws error with helpful message', () => {
			try {
				getPMProvider();
				// Should not reach here
				expect(true).toBe(false);
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toContain('withPMProvider()');
				expect((error as Error).message).toContain('webhook handler');
			}
		});
	});

	describe('getPMProviderOrNull', () => {
		it('returns provider when in context', async () => {
			const provider = createMockProvider();

			await withPMProvider(provider, async () => {
				const retrieved = getPMProviderOrNull();
				expect(retrieved).toBe(provider);
			});
		});

		it('returns null when not in context', () => {
			const result = getPMProviderOrNull();
			expect(result).toBeNull();
		});

		it('does not throw error when not in context', () => {
			expect(() => getPMProviderOrNull()).not.toThrow();
		});
	});

	describe('nested contexts', () => {
		it('inner context overrides outer context', async () => {
			const outerProvider = createMockProvider();
			const innerProvider = createMockProvider();

			await withPMProvider(outerProvider, async () => {
				expect(getPMProvider()).toBe(outerProvider);

				await withPMProvider(innerProvider, async () => {
					expect(getPMProvider()).toBe(innerProvider);
				});

				// After inner context, outer provider is restored
				expect(getPMProvider()).toBe(outerProvider);
			});
		});

		it('handles errors in nested contexts without affecting outer context', async () => {
			const outerProvider = createMockProvider();
			const innerProvider = createMockProvider();

			await withPMProvider(outerProvider, async () => {
				expect(getPMProvider()).toBe(outerProvider);

				try {
					await withPMProvider(innerProvider, async () => {
						throw new Error('Inner error');
					});
				} catch (error) {
					// Expected error
				}

				// Outer context should still be valid
				expect(getPMProvider()).toBe(outerProvider);
			});
		});
	});
});
