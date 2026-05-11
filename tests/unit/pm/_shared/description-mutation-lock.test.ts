import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withDescriptionMutationLock } from '../../../../src/pm/_shared/description-mutation-lock.js';

describe('withDescriptionMutationLock', () => {
	let lockDir: string;

	beforeEach(() => {
		lockDir = mkdtempSync(join(tmpdir(), 'cascade-description-lock-test-'));
	});

	afterEach(() => {
		rmSync(lockDir, { recursive: true, force: true });
	});

	it('serializes concurrent work for the same provider and work item', async () => {
		const events: string[] = [];

		const first = withDescriptionMutationLock(
			'linear',
			'MNG-656',
			async () => {
				events.push('a:start');
				await sleep(20);
				events.push('a:end');
			},
			{ lockDir, pollMs: 1 },
		);
		while (!events.includes('a:start')) await sleep(1);

		await Promise.all([
			first,
			withDescriptionMutationLock(
				'linear',
				'MNG-656',
				async () => {
					events.push('b:start');
					await sleep(1);
					events.push('b:end');
				},
				{ lockDir, pollMs: 1 },
			),
		]);

		expect(events).toHaveLength(4);
		expect(events.indexOf('a:end')).toBeLessThan(events.indexOf('b:start'));
	});

	it('removes stale lock files and continues', async () => {
		const lockPath = join(lockDir, 'jira-PROJ-1.lock');
		writeFileSync(lockPath, JSON.stringify({ token: 'stale', createdAt: 1, pid: 1 }));
		const oldTime = new Date(Date.now() - 10_000);
		await import('node:fs/promises').then((fs) => fs.utimes(lockPath, oldTime, oldTime));

		const result = await withDescriptionMutationLock('jira', 'PROJ-1', async () => 'ok', {
			lockDir,
			staleMs: 1,
			pollMs: 1,
		});

		expect(result).toBe('ok');
		expect(await readdir(lockDir)).toEqual([]);
	});

	it('times out when a fresh lock remains held', async () => {
		const lockPath = join(lockDir, 'linear-MNG-656.lock');
		writeFileSync(lockPath, JSON.stringify({ token: 'held', createdAt: Date.now(), pid: 1 }));

		await expect(
			withDescriptionMutationLock('linear', 'MNG-656', async () => undefined, {
				lockDir,
				timeoutMs: 5,
				staleMs: 60_000,
				pollMs: 1,
			}),
		).rejects.toThrow('Timed out waiting for description mutation lock');
	});

	it('does not release a newer owner lock when the original token is gone', async () => {
		let replacementPath = '';

		await withDescriptionMutationLock(
			'linear',
			'MNG/656',
			async () => {
				const files = await readdir(lockDir);
				replacementPath = join(lockDir, files[0]);
				await unlink(replacementPath);
				await writeFile(
					replacementPath,
					JSON.stringify({ token: 'new-owner', createdAt: Date.now(), pid: process.pid }),
				);
			},
			{ lockDir, pollMs: 1 },
		);

		expect(existsSync(replacementPath)).toBe(true);
		expect(JSON.parse(readFileSync(replacementPath, 'utf8')).token).toBe('new-owner');
	});
});

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
