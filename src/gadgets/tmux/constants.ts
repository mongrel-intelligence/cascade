import { z } from 'llmist';

export const DEFAULT_TIMEOUT_MS = 300000; // 5 min for the gadget itself
export const DEFAULT_WAIT_MS = 120000; // 120s to wait for initial output
export const MAX_WAIT_MS = 120000; // Never wait longer than 120s
export const POLL_INTERVAL_MS = 100; // Faster polling since we have streamed output
export const MAX_OUTPUT_BUFFER = 10 * 1024 * 1024; // 10MB max output per pane

export const CONTROL_SESSION = '_cascade_control';
export const EXIT_MARKER_PREFIX = '___CASCADE_EXIT_';
export const EXIT_MARKER_SUFFIX = '___';

/**
 * Session name schema - accepts any string, sanitized at runtime.
 * Invalid characters (like /) are automatically replaced with dashes.
 */
export const sessionNameSchema = z.string().min(1).max(64);
