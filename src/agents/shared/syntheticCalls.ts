import { type TrackingContext, recordSyntheticInvocationId } from '../utils/tracking.js';
import type { BuilderType } from './builderFactory.js';

/**
 * Helper to inject a single synthetic gadget call with tracking.
 */
export function injectSyntheticCall(
	builder: BuilderType,
	trackingContext: TrackingContext,
	gadgetName: string,
	params: Record<string, unknown>,
	result: string,
	invocationId: string,
): BuilderType {
	recordSyntheticInvocationId(trackingContext, invocationId);
	return builder.withSyntheticGadgetCall(gadgetName, params, result, invocationId);
}
