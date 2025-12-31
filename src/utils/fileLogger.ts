import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';

export interface FileLogger {
	logPath: string;
	llmistLogPath: string;
	write: (level: string, message: string, context?: Record<string, unknown>) => void;
	close: () => void;
	getZippedBuffer: () => Promise<Buffer>;
}

export function createFileLogger(prefix: string): FileLogger {
	const timestamp = Date.now();
	const logPath = path.join(os.tmpdir(), `${prefix}-cascade-${timestamp}.log`);
	const llmistLogPath = path.join(os.tmpdir(), `${prefix}-llmist-${timestamp}.log`);

	// Use sync file descriptor to avoid race condition with getZippedBuffer
	let fd: number | null = fs.openSync(logPath, 'a');

	return {
		logPath,
		llmistLogPath,
		write(level: string, message: string, context?: Record<string, unknown>) {
			if (fd === null) return;
			const ts = new Date().toISOString();
			const line = context
				? `[${ts}] [${level}] ${message} ${JSON.stringify(context)}\n`
				: `[${ts}] [${level}] ${message}\n`;
			fs.writeSync(fd, line);
		},
		close() {
			if (fd !== null) {
				fs.closeSync(fd);
				fd = null;
			}
		},
		async getZippedBuffer(): Promise<Buffer> {
			// fd should be closed before this is called
			return new Promise((resolve, reject) => {
				const chunks: Buffer[] = [];
				const passThrough = new PassThrough();

				passThrough.on('data', (chunk: Buffer) => chunks.push(chunk));
				passThrough.on('end', () => resolve(Buffer.concat(chunks)));
				passThrough.on('error', reject);

				const archive = archiver('zip', { zlib: { level: 9 } });
				archive.on('error', reject);
				archive.pipe(passThrough);

				// Add CASCADE log
				if (fs.existsSync(logPath)) {
					archive.file(logPath, { name: 'cascade.log' });
				}

				// Add llmist log if it exists
				if (fs.existsSync(llmistLogPath)) {
					archive.file(llmistLogPath, { name: 'llmist.log' });
				}

				archive.finalize();
			});
		},
	};
}

export function cleanupLogFile(logPath: string): void {
	try {
		fs.unlinkSync(logPath);
	} catch {
		// Ignore cleanup errors
	}
}
