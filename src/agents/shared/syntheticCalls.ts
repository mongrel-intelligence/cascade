import { imageFromBase64, text } from 'llmist';

import { logger } from '../../utils/logging.js';
import type { ContextImage } from '../contracts/index.js';
import { recordSyntheticInvocationId, type TrackingContext } from '../utils/tracking.js';
import type { BuilderType } from './builderFactory.js';

/** MIME types supported by the llmist SDK for image content parts. */
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * Helper to inject a single synthetic gadget call with tracking.
 *
 * If `images` are provided and the llmist builder supports multimodal content,
 * each image is appended as a follow-up user message after the gadget result text.
 * Images with unsupported MIME types are silently skipped (graceful degradation).
 */
export function injectSyntheticCall(
	builder: BuilderType,
	trackingContext: TrackingContext,
	gadgetName: string,
	params: Record<string, unknown>,
	result: string,
	invocationId: string,
	images?: ContextImage[],
): BuilderType {
	recordSyntheticInvocationId(trackingContext, invocationId);
	let updated = builder.withSyntheticGadgetCall(gadgetName, params, result, invocationId);

	if (images && images.length > 0) {
		const supportedImages = images.filter((img) => {
			if (!SUPPORTED_IMAGE_MIME_TYPES.has(img.mimeType)) {
				logger.warn('Skipping image with unsupported MIME type for llmist injection', {
					mimeType: img.mimeType,
					gadgetName,
					invocationId,
				});
				return false;
			}
			return true;
		});

		if (supportedImages.length > 0) {
			try {
				// Build a multimodal user message: descriptive text + image content parts
				const altDescription =
					supportedImages.length === 1
						? (supportedImages[0].altText ?? 'Image from context')
						: `${supportedImages.length} images from context`;
				const contentParts = [
					text(`[Images from ${gadgetName} result — ${altDescription}]`),
					...supportedImages.map((img) =>
						imageFromBase64(img.base64Data, img.mimeType as Parameters<typeof imageFromBase64>[1]),
					),
				];
				updated = updated.addMessage({ user: contentParts });
			} catch (err) {
				// Graceful degradation: if image injection fails, continue without images
				logger.warn('Failed to inject images into synthetic gadget call — falling back to text', {
					gadgetName,
					invocationId,
					imageCount: supportedImages.length,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}

	return updated;
}
