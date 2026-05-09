import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	appendFiledFrictionReport,
	appendQueuedFrictionReport,
	compactPendingFrictionReports,
	readFrictionSidecarEvents,
	rewriteFrictionSidecarWithPending,
} from '../../../src/friction/sidecar.js';
import type { FrictionReport } from '../../../src/friction/types.js';

let tempDir: string;

function makeReport(reportId: string, summary = 'A thing happened'): FrictionReport {
	return {
		reportId,
		summary,
		details: 'Details',
		category: 'other',
		severity: 'low',
		whileDoing: 'running tests',
		context: { project: { id: 'proj-1' } },
	};
}

describe('friction sidecar helpers', () => {
	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'cascade-friction-sidecar-'));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it('appends queued and filed JSONL events', async () => {
		const path = join(tempDir, 'nested', 'friction.jsonl');

		await appendQueuedFrictionReport(path, makeReport('r1'), '2026-05-09T18:00:00.000Z');
		await appendFiledFrictionReport(
			path,
			{ reportId: 'r1', workItemId: 'card-1', workItemUrl: 'https://pm.example/card-1' },
			'2026-05-09T18:01:00.000Z',
		);

		const events = await readFrictionSidecarEvents(path);
		expect(events).toEqual([
			expect.objectContaining({ event: 'queued', reportId: 'r1' }),
			expect.objectContaining({
				event: 'filed',
				reportId: 'r1',
				workItemId: 'card-1',
				workItemUrl: 'https://pm.example/card-1',
			}),
		]);

		const raw = await readFile(path, 'utf-8');
		expect(raw.trim().split('\n')).toHaveLength(2);
	});

	it('compacts pending reports by reportId and removes filed reports', async () => {
		const path = join(tempDir, 'friction.jsonl');

		await appendQueuedFrictionReport(path, makeReport('r1', 'old'), '2026-05-09T18:00:00.000Z');
		await appendQueuedFrictionReport(path, makeReport('r2'), '2026-05-09T18:01:00.000Z');
		await appendQueuedFrictionReport(path, makeReport('r1', 'new'), '2026-05-09T18:02:00.000Z');
		await appendFiledFrictionReport(path, { reportId: 'r2', workItemId: 'card-2' });

		const pending = await compactPendingFrictionReports(path);
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({
			event: 'queued',
			reportId: 'r1',
			report: { summary: 'new' },
		});
	});

	it('rewrites a sidecar to the compact pending queued events only', async () => {
		const path = join(tempDir, 'friction.jsonl');
		await appendQueuedFrictionReport(path, makeReport('r1'), '2026-05-09T18:00:00.000Z');
		await appendQueuedFrictionReport(path, makeReport('r2'), '2026-05-09T18:01:00.000Z');
		await appendFiledFrictionReport(path, { reportId: 'r1', workItemId: 'card-1' });

		const pending = await rewriteFrictionSidecarWithPending(path);
		const events = await readFrictionSidecarEvents(path);

		expect(pending.map((event) => event.reportId)).toEqual(['r2']);
		expect(events).toEqual([expect.objectContaining({ event: 'queued', reportId: 'r2' })]);
	});

	it('ignores malformed JSONL lines while reading', async () => {
		const path = join(tempDir, 'friction.jsonl');
		await writeFile(
			path,
			`${JSON.stringify({ event: 'queued', reportId: 'r1', report: makeReport('r1'), timestamp: 't1' })}\nnot json\n`,
			'utf-8',
		);

		const events = await readFrictionSidecarEvents(path);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ event: 'queued', reportId: 'r1' });
	});
});
