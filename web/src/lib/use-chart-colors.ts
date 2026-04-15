/**
 * Theme-aware chart color hook.
 *
 * Recharts requires actual hex values (not CSS variables), so this hook
 * selects the correct palette based on the current theme and returns a
 * theme-aware getAgentColor function that triggers re-renders on theme change.
 */

import { useTheme } from 'next-themes';
import { CHART_PALETTE_DARK, CHART_PALETTE_LIGHT, getAgentColor } from './chart-colors.js';

/**
 * Returns a theme-aware getAgentColor function.
 * Re-renders automatically when the theme changes.
 *
 * @example
 * const getColor = useChartColors();
 * // In recharts: fill={getColor(agentType)}
 */
export function useChartColors(): (agentType: string) => string {
	const { resolvedTheme } = useTheme();
	const palette = resolvedTheme === 'dark' ? CHART_PALETTE_DARK : CHART_PALETTE_LIGHT;
	return (agentType: string) => getAgentColor(agentType, palette);
}
