import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources';
import { describe, expect, it, vi } from 'vitest';
import type { ContextImage } from '../../../src/agents/contracts/index.js';
import { buildPromptWithImages } from '../../../src/backends/claude-code/index.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
	query: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	storeLlmCall: vi.fn().mockResolvedValue(undefined),
}));

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
	const results: T[] = [];
	for await (const item of iterable) results.push(item);
	return results;
}

const PNG_IMAGE: ContextImage = {
	base64Data: 'aGVsbG8=',
	mimeType: 'image/png',
	altText: 'A diagram',
};

const JPEG_IMAGE: ContextImage = {
	base64Data: 'dGVzdA==',
	mimeType: 'image/jpeg',
};

const TIFF_IMAGE: ContextImage = {
	base64Data: 'dGlmZg==',
	mimeType: 'image/tiff', // unsupported
};

describe('buildPromptWithImages', () => {
	it('yields one SDKUserMessage with text block + image block', async () => {
		const msgs = await collect(buildPromptWithImages('do task', [PNG_IMAGE]));

		expect(msgs).toHaveLength(1);
		const msg = msgs[0];
		expect(msg.type).toBe('user');
		expect(msg.message.role).toBe('user');

		const content = msg.message.content as ContentBlockParam[];
		expect(content).toHaveLength(2);
		expect(content[0]).toEqual({ type: 'text', text: 'do task' });
		expect(content[1].type).toBe('image');
		const imageBlock = content[1] as {
			type: 'image';
			source: { type: string; media_type: string; data: string };
		};
		expect(imageBlock.source.type).toBe('base64');
		expect(imageBlock.source.media_type).toBe('image/png');
		expect(imageBlock.source.data).toBe('aGVsbG8=');
	});

	it('sets a non-empty session_id and null parent_tool_use_id', async () => {
		const msgs = await collect(buildPromptWithImages('task', [PNG_IMAGE]));
		const msg = msgs[0];
		expect(msg.session_id).toBeTruthy();
		expect(msg.parent_tool_use_id).toBeNull();
	});

	it('includes multiple images as separate image blocks', async () => {
		const msgs = await collect(buildPromptWithImages('task', [PNG_IMAGE, JPEG_IMAGE]));
		const content = msgs[0].message.content as ContentBlockParam[];
		expect(content).toHaveLength(3); // text + 2 images
		expect(content[0].type).toBe('text');
		expect(content[1].type).toBe('image');
		expect(content[2].type).toBe('image');
	});

	it('filters out unsupported MIME types', async () => {
		const msgs = await collect(buildPromptWithImages('task', [PNG_IMAGE, TIFF_IMAGE]));
		const content = msgs[0].message.content as ContentBlockParam[];
		// text + 1 image (TIFF filtered out)
		expect(content).toHaveLength(2);
		expect(content[0].type).toBe('text');
		expect(content[1].type).toBe('image');
	});

	it('yields text-only message when all images are unsupported', async () => {
		const msgs = await collect(buildPromptWithImages('task', [TIFF_IMAGE]));
		const content = msgs[0].message.content as ContentBlockParam[];
		expect(content).toHaveLength(1);
		expect(content[0]).toEqual({ type: 'text', text: 'task' });
	});

	it('yields text-only message when images array is empty', async () => {
		const msgs = await collect(buildPromptWithImages('task', []));
		const content = msgs[0].message.content as ContentBlockParam[];
		expect(content).toHaveLength(1);
		expect(content[0]).toEqual({ type: 'text', text: 'task' });
	});

	it('yields exactly one message', async () => {
		const msgs = await collect(buildPromptWithImages('task', [PNG_IMAGE, JPEG_IMAGE, TIFF_IMAGE]));
		expect(msgs).toHaveLength(1);
	});

	it('each call produces a unique session_id', async () => {
		const msgs1 = await collect(buildPromptWithImages('task', [PNG_IMAGE]));
		const msgs2 = await collect(buildPromptWithImages('task', [PNG_IMAGE]));
		expect(msgs1[0].session_id).not.toBe(msgs2[0].session_id);
	});
});
