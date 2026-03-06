/**
 * Configuration for Claude Code backend context offloading.
 *
 * When the total context injections exceed the inline threshold,
 * large context is written to files and Claude is instructed to
 * read them on-demand using its Read tool.
 */
export const CONTEXT_OFFLOAD_CONFIG = {
	/**
	 * Token threshold below which context is embedded inline in the prompt.
	 * Context injections smaller than this are included directly.
	 * Larger content is offloaded to files.
	 */
	inlineThreshold: 8_000,

	/**
	 * Directory for offloaded context files (relative to repo root).
	 * Files are written here and cleaned up after agent completion.
	 */
	contextDir: '.cascade/context',

	/**
	 * Whether context offloading is enabled.
	 * Set to false to disable offloading (all context embedded inline).
	 * Useful for debugging or when file I/O is problematic.
	 */
	enabled: true,
} as const;
