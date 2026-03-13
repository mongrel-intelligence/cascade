/**
 * Shared color mapping for agent types used in recharts visualizations.
 *
 * Recharts requires actual color values (not CSS variables), so we define
 * both light and dark theme colors here, matching the CSS custom properties
 * in index.css. We use a static mapping for simplicity and dark-mode compat.
 */

// Light-mode hex equivalents of the oklch chart colors from index.css
// chart-1: oklch(0.646 0.222 41.116) ≈ #e8642a (orange)
// chart-2: oklch(0.6 0.118 184.704)  ≈ #3aada0 (teal)
// chart-3: oklch(0.398 0.07 227.392) ≈ #4a7a9b (steel blue)
// chart-4: oklch(0.828 0.189 84.429) ≈ #d4c02a (yellow)
// chart-5: oklch(0.769 0.188 70.08)  ≈ #d99c27 (amber)

// We use a small palette that works in both light and dark mode
const CHART_PALETTE = [
	'#e8642a', // chart-1: orange → planning
	'#3aada0', // chart-2: teal → implementation
	'#4a7a9b', // chart-3: steel blue → review
	'#d4c02a', // chart-4: yellow → splitting
	'#d99c27', // chart-5: amber → debug
	'#9b59b6', // purple → respond-to-review
	'#e74c3c', // red → respond-to-ci
	'#2ecc71', // green → other agents
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

/**
 * Returns a color string for the given agent type.
 * Falls back to a consistent color based on the string hash for unknown types.
 */
export function getAgentColor(agentType: string): string {
	const idx = KNOWN_AGENT_TYPES[agentType];
	if (idx !== undefined) {
		return CHART_PALETTE[idx];
	}
	// Hash-based fallback for unknown agent types
	let hash = 0;
	for (let i = 0; i < agentType.length; i++) {
		hash = (hash * 31 + agentType.charCodeAt(i)) % CHART_PALETTE.length;
	}
	return CHART_PALETTE[Math.abs(hash) % CHART_PALETTE.length];
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
