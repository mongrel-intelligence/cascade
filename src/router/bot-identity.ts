/**
 * Generic per-project bot identity cache with TTL eviction.
 *
 * Consolidates the identical TTL-cache pattern used separately for Trello
 * (`trelloBotCache`) and JIRA (`jiraBotCache`) in `acknowledgments.ts`.
 *
 * Usage:
 *   const trelloCache = new BotIdentityCache<string>('memberId');
 *   const id = await trelloCache.resolve('projectId', () => fetchMemberId());
 */

const IDENTITY_CACHE_TTL_MS = 60_000; // 60 seconds

export class BotIdentityCache<T> {
	private readonly cache = new Map<string, { value: T; expiresAt: number }>();
	private readonly fieldName: string;

	constructor(fieldName: string) {
		this.fieldName = fieldName;
	}

	/**
	 * Return the cached value for `key`, or call `resolver()` to fetch and cache it.
	 * Returns `null` if the resolver returns null/undefined or throws.
	 */
	async resolve(key: string, resolver: () => Promise<T | null | undefined>): Promise<T | null> {
		const cached = this.cache.get(key);
		if (cached && Date.now() < cached.expiresAt) return cached.value;

		try {
			const value = await resolver();
			if (value == null) return null;
			this.cache.set(key, { value, expiresAt: Date.now() + IDENTITY_CACHE_TTL_MS });
			return value;
		} catch {
			return null;
		}
	}

	/** @internal Visible for testing only. */
	_reset(): void {
		this.cache.clear();
	}

	get _fieldName(): string {
		return this.fieldName;
	}
}
