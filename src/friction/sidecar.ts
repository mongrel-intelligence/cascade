import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
	FrictionFiledEvent,
	FrictionQueuedEvent,
	FrictionReport,
	FrictionSidecarEvent,
} from './types.js';

async function appendJsonLine(path: string, event: FrictionSidecarEvent): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(event)}\n`, { encoding: 'utf-8', flag: 'a' });
}

export async function appendQueuedFrictionReport(
	path: string,
	report: FrictionReport,
	timestamp = new Date().toISOString(),
): Promise<void> {
	await appendJsonLine(path, {
		event: 'queued',
		reportId: report.reportId,
		report,
		timestamp,
	});
}

export async function appendFiledFrictionReport(
	path: string,
	input: { reportId: string; workItemId: string; workItemUrl?: string },
	timestamp = new Date().toISOString(),
): Promise<void> {
	await appendJsonLine(path, {
		event: 'filed',
		reportId: input.reportId,
		workItemId: input.workItemId,
		workItemUrl: input.workItemUrl,
		timestamp,
	});
}

export async function readFrictionSidecarEvents(path: string): Promise<FrictionSidecarEvent[]> {
	let raw: string;
	try {
		raw = await readFile(path, 'utf-8');
	} catch (err) {
		if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return [];
		throw err;
	}

	return raw
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.flatMap((line) => {
			try {
				const parsed = JSON.parse(line) as FrictionSidecarEvent;
				return parsed.event === 'queued' || parsed.event === 'filed' ? [parsed] : [];
			} catch {
				return [];
			}
		});
}

export async function compactPendingFrictionReports(path: string): Promise<FrictionQueuedEvent[]> {
	const byReportId = new Map<string, FrictionQueuedEvent>();
	for (const event of await readFrictionSidecarEvents(path)) {
		if (event.event === 'queued') {
			byReportId.set(event.reportId, event);
		} else {
			byReportId.delete(event.reportId);
		}
	}
	return [...byReportId.values()];
}

export async function rewriteFrictionSidecarWithPending(
	path: string,
): Promise<FrictionQueuedEvent[]> {
	const pending = await compactPendingFrictionReports(path);
	await mkdir(dirname(path), { recursive: true });
	const content = pending.map((event) => JSON.stringify(event)).join('\n');
	await writeFile(path, content ? `${content}\n` : '', 'utf-8');
	return pending;
}

export type { FrictionFiledEvent, FrictionQueuedEvent };
