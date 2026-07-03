import { describe, expect, it, vi } from 'vitest';

// `createSingleFileTar` is the hand-rolled POSIX-ustar builder that feeds
// `docker.buildImage()` its one-file build context (the composed Dockerfile).
// It is the riskiest hand-written code in the spec-023 sequence, previously
// verified only by reviewer reasoning + an incidental smoke assertion in
// worker-image-build.test.ts. This suite asserts the ustar byte layout directly
// (MNG-1726).
//
// The function itself is pure, but `worker-image-build.ts` pulls in dockerode +
// DB + config + sentry at module load, so mock those heavy modules to keep the
// import Docker-/DB-free — mirrors tests/unit/router/worker-image-build.test.ts.
vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		getImage: vi.fn(),
		buildImage: vi.fn(),
		modem: { followProgress: vi.fn() },
	})),
}));
vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		workerImage: 'ghcr.io/acme/cascade-worker:latest',
		workerBuildTimeoutMs: 600_000,
		dockerNetwork: 'test-network',
		workerMemoryMb: 512,
	},
}));
vi.mock('../../../src/router/worker-snapshots.js', () => ({
	pullImageOnce: vi.fn(),
	isImageNotFoundError: vi.fn().mockReturnValue(false),
}));
vi.mock('../../../src/router/worker-image-validation.js', () => ({
	resolveDigestFromRepoDigests: vi.fn(),
	runWorkerImageSmokeTest: vi.fn(),
}));
vi.mock('../../../src/db/repositories/projectsRepository.js', () => ({
	readWorkerImageBuildInputs: vi.fn(),
	recordWorkerImageBuildResult: vi.fn(),
}));
vi.mock('../../../src/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { composeDockerfile } from '../../../src/router/worker-dockerfile-compose.js';
import { createSingleFileTar } from '../../../src/router/worker-image-build.js';

// POSIX ustar header field byte-offsets (see the tar(5) man page).
const OFF = {
	name: 0,
	mode: 100,
	uid: 108,
	gid: 116,
	size: 124,
	mtime: 136,
	chksum: 148,
	typeflag: 156,
	magic: 257,
	version: 263,
} as const;

const BLOCK = 512;

/** Read a NUL-terminated (or full-width) ASCII field as a trimmed string. */
function fieldStr(buf: Buffer, off: number, len: number): string {
	const slice = buf.subarray(off, off + len);
	const nul = slice.indexOf(0);
	return slice.subarray(0, nul === -1 ? len : nul).toString('utf-8');
}

/** Parse an octal-encoded ASCII numeric field (size, mode, mtime, ...). */
function fieldOctal(buf: Buffer, off: number, len: number): number {
	const s = fieldStr(buf, off, len).trim();
	return s === '' ? 0 : Number.parseInt(s, 8);
}

interface TarEntry {
	name: string;
	size: number;
	body: Buffer;
}

/**
 * Minimal ustar reader: walk 512-byte blocks, stopping at the first all-zero
 * header block (the archive terminator). Deliberately hand-rolled — the point is
 * to prove the emitted bytes parse back without leaning on the same library the
 * producer might use.
 */
function parseUstar(buf: Buffer): TarEntry[] {
	const entries: TarEntry[] = [];
	let offset = 0;
	while (offset + BLOCK <= buf.length) {
		const header = buf.subarray(offset, offset + BLOCK);
		if (header.every((b) => b === 0)) break; // end-of-archive marker block
		const name = fieldStr(header, OFF.name, 100);
		const size = fieldOctal(header, OFF.size, 12);
		const body = Buffer.from(buf.subarray(offset + BLOCK, offset + BLOCK + size));
		entries.push({ name, size, body });
		offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
	}
	return entries;
}

describe('createSingleFileTar — ustar header layout', () => {
	const content = 'FROM ghcr.io/acme/cascade-worker@sha256:base\nRUN true\n';
	const tar = createSingleFileTar('Dockerfile', content);
	const bodyLen = Buffer.byteLength(content, 'utf-8');

	it('writes the file name at offset 0', () => {
		expect(fieldStr(tar, OFF.name, 100)).toBe('Dockerfile');
	});

	it('writes mode 0644 at offset 100', () => {
		expect(fieldStr(tar, OFF.mode, 8)).toBe('0000644');
		expect(fieldOctal(tar, OFF.mode, 8)).toBe(0o644);
	});

	it('writes uid 0 at offset 108', () => {
		expect(fieldOctal(tar, OFF.uid, 8)).toBe(0);
	});

	it('writes gid 0 at offset 116', () => {
		expect(fieldOctal(tar, OFF.gid, 8)).toBe(0);
	});

	it('writes the octal body size at offset 124', () => {
		expect(fieldOctal(tar, OFF.size, 12)).toBe(bodyLen);
	});

	it('writes a plausible octal mtime (unix seconds) at offset 136', () => {
		const before = Math.floor(Date.now() / 1000);
		const fresh = createSingleFileTar('Dockerfile', content);
		const after = Math.floor(Date.now() / 1000);
		const mtime = fieldOctal(fresh, OFF.mtime, 12);
		expect(mtime).toBeGreaterThanOrEqual(before);
		expect(mtime).toBeLessThanOrEqual(after);
	});

	it('marks a regular-file typeflag "0" at offset 156', () => {
		expect(String.fromCharCode(tar[OFF.typeflag])).toBe('0');
	});

	it('writes the ustar magic at offset 257 (NUL-terminated)', () => {
		expect(tar.subarray(OFF.magic, OFF.magic + 5).toString('utf-8')).toBe('ustar');
		expect(tar[OFF.magic + 5]).toBe(0); // magic is `ustar\0`
	});

	it('writes ustar version "00" at offset 263', () => {
		expect(tar.subarray(OFF.version, OFF.version + 2).toString('utf-8')).toBe('00');
	});
});

describe('createSingleFileTar — header checksum', () => {
	it('stores the checksum as 6 octal digits + NUL + space', () => {
		const tar = createSingleFileTar('Dockerfile', 'RUN true\n');
		expect(fieldStr(tar, OFF.chksum, 6)).toMatch(/^[0-7]{6}$/);
		expect(tar[OFF.chksum + 6]).toBe(0); // NUL after the 6 octal digits
		expect(tar[OFF.chksum + 7]).toBe(0x20); // trailing space
	});

	it('equals the sum of all 512 header bytes with the chksum field space-filled', () => {
		const tar = createSingleFileTar('Dockerfile', 'FROM x\nENV A=1\nCOPY . /app\n');
		const stored = fieldOctal(tar, OFF.chksum, 8);

		// Recompute per the ustar spec: the 8-byte checksum field is treated as
		// ASCII spaces (0x20) while summing every one of the 512 header bytes.
		const header = Buffer.from(tar.subarray(0, BLOCK));
		for (let i = OFF.chksum; i < OFF.chksum + 8; i++) header[i] = 0x20;
		let sum = 0;
		for (let i = 0; i < BLOCK; i++) sum += header[i];

		expect(stored).toBe(sum);
	});
});

describe('createSingleFileTar — body padding + trailer', () => {
	it('emits the body verbatim then zero-pads up to the next 512 boundary', () => {
		const content = 'abc'; // 3 bytes → 509 zero pad bytes to fill the block
		const tar = createSingleFileTar('Dockerfile', content);
		const bodyLen = 3;

		expect(tar.subarray(BLOCK, BLOCK + bodyLen).toString('utf-8')).toBe(content);
		const pad = tar.subarray(BLOCK + bodyLen, BLOCK + BLOCK);
		expect(pad.every((b) => b === 0)).toBe(true);
	});

	it('adds no extra padding when the body length is an exact 512 multiple', () => {
		const tar = createSingleFileTar('Dockerfile', 'x'.repeat(BLOCK));
		// header (512) + body (512, no pad) + trailer (1024)
		expect(tar.length).toBe(BLOCK + BLOCK + 2 * BLOCK);
	});

	it('terminates the archive with two 512-byte zero blocks (1024 trailing zeros)', () => {
		const tar = createSingleFileTar('Dockerfile', 'RUN true\n');
		const trailer = tar.subarray(tar.length - 2 * BLOCK);
		expect(trailer.length).toBe(1024);
		expect(trailer.every((b) => b === 0)).toBe(true);
	});

	it('always produces a total length that is a 512-byte multiple', () => {
		for (const c of ['', 'a', 'x'.repeat(511), 'x'.repeat(512), 'x'.repeat(513)]) {
			expect(createSingleFileTar('Dockerfile', c).length % BLOCK).toBe(0);
		}
	});

	it('encodes an empty file as header + trailer with a zero size field', () => {
		const tar = createSingleFileTar('Dockerfile', '');
		expect(fieldOctal(tar, OFF.size, 12)).toBe(0);
		expect(tar.length).toBe(BLOCK + 2 * BLOCK);
	});
});

describe('createSingleFileTar — single-file round-trip', () => {
	it('contains exactly one Dockerfile entry with the composed content', () => {
		const composed = composeDockerfile(
			'RUN apt-get install -y jq',
			'ghcr.io/acme/cascade-worker@sha256:base',
		);
		const tar = createSingleFileTar('Dockerfile', composed);

		const entries = parseUstar(tar);
		expect(entries).toHaveLength(1);
		expect(entries[0].name).toBe('Dockerfile');
		expect(entries[0].size).toBe(Buffer.byteLength(composed, 'utf-8'));
		expect(entries[0].body.toString('utf-8')).toBe(composed);
	});

	it('round-trips multibyte UTF-8 content with a byte-accurate size field', () => {
		const content = '# café ☕ layer\nRUN echo "üñîçødé"\n';
		const tar = createSingleFileTar('Dockerfile', content);

		const entries = parseUstar(tar);
		expect(entries).toHaveLength(1);
		// A multibyte string ⇒ byte length exceeds character length; the size
		// field must be byte-accurate for docker to read the whole Dockerfile.
		expect(entries[0].size).toBe(Buffer.byteLength(content, 'utf-8'));
		expect(entries[0].size).toBeGreaterThan(content.length);
		expect(entries[0].body.toString('utf-8')).toBe(content);
	});

	it('preserves the requested entry name', () => {
		const tar = createSingleFileTar('Dockerfile', 'RUN true\n');
		expect(parseUstar(tar).map((e) => e.name)).toEqual(['Dockerfile']);
	});
});
