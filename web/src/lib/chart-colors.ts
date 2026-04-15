/**
 * Shared color mapping for agent types used in recharts visualizations.
 *
 * Recharts requires actual color values (not CSS variables), so we use hex
 * palettes. A dual-palette system allows theme-aware color selection via the
 * useChartColors hook in use-chart-colors.ts.
 */

// Hex approximations of the light-mode oklch chart colors from index.css:
// chart-1: oklch(0.646 0.222 41.116) ≈ #e8642a (orange)
// chart-2: oklch(0.6 0.118 184.704)  ≈ #3aada0 (teal)
// chart-3: oklch(0.398 0.07 227.392) ≈ #4a7a9b (steel blue)
// chart-4: oklch(0.828 0.189 84.429) ≈ #d4c02a (yellow)
// chart-5: oklch(0.769 0.188 70.08)  ≈ #d99c27 (amber)
export const CHART_PALETTE_LIGHT = [
	'#e8642a', // chart-1: orange → planning
	'#3aada0', // chart-2: teal → implementation
	'#4a7a9b', // chart-3: steel blue → review
	'#d4c02a', // chart-4: yellow → splitting
	'#d99c27', // chart-5: amber → debug
	'#9b59b6', // purple → respond-to-review
	'#e74c3c', // red → respond-to-ci
	'#2ecc71', // green → other agents
];

// Hex approximations of the dark-mode oklch chart colors from index.css .dark:
// chart-1: oklch(0.488 0.243 264.376) ≈ #4060d8 (blue-violet)
// chart-2: oklch(0.696 0.17 162.48)   ≈ #40c087 (emerald)
// chart-3: oklch(0.769 0.188 70.08)   ≈ #d99c27 (amber)
// chart-4: oklch(0.627 0.265 303.9)   ≈ #b045d4 (purple)
// chart-5: oklch(0.645 0.246 16.439)  ≈ #e04a3a (red-orange)
export const CHART_PALETTE_DARK = [
	'#4060d8', // chart-1: blue-violet → planning
	'#40c087', // chart-2: emerald → implementation
	'#d99c27', // chart-3: amber → review
	'#b045d4', // chart-4: purple → splitting
	'#e04a3a', // chart-5: red-orange → debug
	'#7b68ee', // medium slate blue → respond-to-review
	'#ff6b6b', // salmon → respond-to-ci
	'#52d67a', // green → other agents
];

const KNOWN_AGENT_TYPES: Record<string, number> = {
	planning: 0,
	implementation: 1,
	review: 2,
	splitting: 3,
	debug: 4,
	'respond-to-review': 5,
	'respond-to-ci': 6,
	'respond-to-pr-comment': 6,
	'respond-to-planning-comment': 6,
};

function pickColor(agentType: string, palette: string[]): string {
	const idx = KNOWN_AGENT_TYPES[agentType];
	if (idx !== undefined) {
		return palette[idx];
	}
	// Hash-based fallback for unknown agent types
	let hash = 0;
	for (let i = 0; i < agentType.length; i++) {
		hash = (hash * 31 + agentType.charCodeAt(i)) % palette.length;
	}
	return palette[Math.abs(hash) % palette.length];
}

/**
 * Returns a color string for the given agent type using the light-mode palette.
 * For theme-aware colors, use the useChartColors hook from use-chart-colors.ts.
 * Falls back to a consistent color based on the string hash for unknown types.
 */
export function getAgentColor(agentType: string, palette?: string[]): string {
	return pickColor(agentType, palette ?? CHART_PALETTE_LIGHT);
}

/**
 * Human-readable label for an agent type.
 * e.g. "respond-to-review" → "Respond to Review"
 */
export function agentTypeLabel(agentType: string): string {
	return agentType
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}
