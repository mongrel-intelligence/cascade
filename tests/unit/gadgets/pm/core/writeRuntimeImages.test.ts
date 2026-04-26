import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMkdir, mockWriteFile, mockAccess } = vi.hoisted(() => ({
	mockMkdir: vi.fn().mockResolvedValue(undefined),
	mockWriteFile: vi.fn().mockResolvedValue(undefined),
	mockAccess: vi.fn().mockRejectedValue(new Error('ENOENT')),
}));

vi.mock('node:fs/promises', () => ({
	mkdir: mockMkdir,
	writeFile: mockWriteFile,
	access: mockAccess,
}));

vi.mock('../../../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { writeRuntimeImages } from '../../../../../src/gadgets/pm/core/writeRuntimeImages.js';
import { logger } from '../../../../../src/utils/logging.js';

const mockLogger = vi.mocked(logger);

describe('writeRuntimeImages', () => {
	beforeEach(() => {
		mockMkdir.mockReset();
		mockMkdir.mockResolvedValue(undefined);
		mockWriteFile.mockReset();
		mockWriteFile.mockResolvedValue(undefined);
		mockAccess.mockReset();
		mockAccess.mockRejectedValue(new Error('ENOENT'));
		mockLogger.info.mockReset();
		mockLogger.warn.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('writes each image with work-item-<id>-img-<index>.<ext>', async () => {
		const result = await writeRuntimeImages({
			workItemId: 'MNG-357',
			images: [
				{ base64Data: Buffer.from('a').toString('base64'), mimeType: 'image/png' },
				{ base64Data: Buffer.from('b').toString('base64'), mimeType: 'image/jpeg' },
			],
		});

		expect(mockWriteFile).toHaveBeenCalledTimes(2);
		const firstPath = mockWriteFile.mock.calls[0][0] as string;
		const secondPath = mockWriteFile.mock.calls[1][0] as string;
		expect(firstPath).toContain('work-item-MNG-357-img-0.png');
		expect(secondPath).toContain('work-item-MNG-357-img-1.jpg');
		expect(result.paths).toHaveLength(2);
	});

	it('derives extension from resolved MIME, NOT from URL', async () => {
		await writeRuntimeImages({
			workItemId: 'card-1',
			images: [{ base64Data: Buffer.from('x').toString('base64'), mimeType: 'image/webp' }],
		});

		const path = mockWriteFile.mock.calls[0][0] as string;
		expect(path).toMatch(/work-item-card-1-img-0\.webp$/);
	});

	it('falls back to .bin extension when MIME resolution failed (image/* sentinel)', async () => {
		await writeRuntimeImages({
			workItemId: 'MNG-1',
			images: [{ base64Data: Buffer.from('x').toString('base64'), mimeType: 'image/*' }],
		});

		const path = mockWriteFile.mock.calls[0][0] as string;
		expect(path).toMatch(/work-item-MNG-1-img-0\.bin$/);
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('writeRuntimeImages: unresolved MIME'),
			expect.objectContaining({ workItemId: 'MNG-1', mimeType: 'image/*' }),
		);
	});

	it('returns the list of relative paths it wrote', async () => {
		const result = await writeRuntimeImages({
			workItemId: 'w1',
			images: [
				{ base64Data: Buffer.from('a').toString('base64'), mimeType: 'image/png' },
				{ base64Data: Buffer.from('b').toString('base64'), mimeType: 'image/png' },
			],
		});

		expect(result.paths).toEqual([
			'.cascade/context/images/work-item-w1-img-0.png',
			'.cascade/context/images/work-item-w1-img-1.png',
		]);
	});

	it('creates the .cascade/context/images directory if it does not exist', async () => {
		await writeRuntimeImages({
			workItemId: 'w1',
			images: [{ base64Data: Buffer.from('x').toString('base64'), mimeType: 'image/png' }],
		});

		// mkdir called with recursive: true at least once
		expect(mockMkdir).toHaveBeenCalled();
		const firstCall = mockMkdir.mock.calls[0];
		expect(firstCall[1]).toEqual({ recursive: true });
	});

	it('returns empty paths when given no images', async () => {
		const result = await writeRuntimeImages({ workItemId: 'w1', images: [] });
		expect(result.paths).toHaveLength(0);
		expect(mockWriteFile).not.toHaveBeenCalled();
	});

	it('captures write failure as a failure entry, does not throw', async () => {
		mockWriteFile.mockRejectedValueOnce(new Error('disk full'));

		const result = await writeRuntimeImages({
			workItemId: 'w1',
			images: [
				{ base64Data: Buffer.from('a').toString('base64'), mimeType: 'image/png' },
				{ base64Data: Buffer.from('b').toString('base64'), mimeType: 'image/png' },
			],
		});

		expect(result.paths).toHaveLength(1); // only the second succeeded
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0].reason).toContain('disk full');
	});

	it('uses repoDir-relative path when repoDir option provided', async () => {
		await writeRuntimeImages({
			workItemId: 'w1',
			images: [{ base64Data: Buffer.from('x').toString('base64'), mimeType: 'image/png' }],
			repoDir: '/tmp/my-repo',
		});

		const path = mockWriteFile.mock.calls[0][0] as string;
		expect(path).toContain('/tmp/my-repo/.cascade/context/images/work-item-w1-img-0.png');
	});
});
