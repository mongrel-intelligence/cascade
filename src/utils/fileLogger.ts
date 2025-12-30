import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

export interface FileLogger {
	logPath: string;
	write: (level: string, message: string, context?: Record<string, unknown>) => void;
	close: () => void;
	getZippedBuffer: () => Buffer;
}

export function createFileLogger(prefix: string): FileLogger {
	const logPath = path.join(os.tmpdir(), `${prefix}-${Date.now()}.log`);
	const stream = fs.createWriteStream(logPath, { flags: 'a' });

	return {
		logPath,
		write(level: string, message: string, context?: Record<string, unknown>) {
			const timestamp = new Date().toISOString();
			const line = context
				? `[${timestamp}] [${level}] ${message} ${JSON.stringify(context)}\n`
				: `[${timestamp}] [${level}] ${message}\n`;
			stream.write(line);
		},
		close() {
			stream.end();
		},
		getZippedBuffer() {
			const content = fs.readFileSync(logPath);
			return gzipSync(content);
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
