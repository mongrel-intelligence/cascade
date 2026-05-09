export { formatFrictionReport } from './format.js';
export { materializeFrictionReport } from './materialize.js';
export {
	appendFiledFrictionReport,
	appendQueuedFrictionReport,
	compactPendingFrictionReports,
	readFrictionSidecarEvents,
	rewriteFrictionSidecarWithPending,
} from './sidecar.js';
export type {
	FormattedFrictionReport,
	FrictionCategory,
	FrictionFiledEvent,
	FrictionMaterializationResult,
	FrictionQueuedEvent,
	FrictionReport,
	FrictionRuntimeContext,
	FrictionSeverity,
	FrictionSidecarEvent,
} from './types.js';
