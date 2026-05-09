/**
 * Convert a PascalCase or camelCase tool name to a kebab-case CLI command segment.
 *
 * Examples:
 * - 'PostComment' -> 'post-comment'
 * - 'ReadWorkItem' -> 'read-work-item'
 * - 'CreatePR' -> 'create-pr'
 */
export function toKebabCase(name: string): string {
	return name
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
		.replace(/([a-z\d])([A-Z])/g, '$1-$2')
		.toLowerCase();
}

/**
 * Derive the CLI command prefix for a tool based on its category.
 */
export function deriveCLICommand(toolName: string, cliCommandOverride?: string): string {
	if (cliCommandOverride) return cliCommandOverride;

	if (toolName === 'Finish') {
		return `cascade-tools session ${toKebabCase(toolName)}`;
	}

	const scmPrefixes = [
		'createpr',
		'getpr',
		'postpr',
		'updatepr',
		'replytoreview',
		'createprreview',
		'getciru',
	];
	const lowerName = toolName.toLowerCase();
	if (
		scmPrefixes.some((p) => lowerName.startsWith(p)) ||
		lowerName.includes('pr') ||
		lowerName.includes('ci')
	) {
		if (
			toolName.startsWith('CreatePR') ||
			toolName.startsWith('GetPR') ||
			toolName.startsWith('PostPR') ||
			toolName.startsWith('UpdatePR') ||
			toolName.startsWith('ReplyTo') ||
			toolName === 'GetCIRunLogs'
		) {
			return `cascade-tools scm ${toKebabCase(toolName)}`;
		}
	}

	let commandName = toolName;
	if (toolName.startsWith('PM') && toolName.length > 2 && /[A-Z]/.test(toolName[2])) {
		commandName = toolName.slice(2);
	}

	return `cascade-tools pm ${toKebabCase(commandName)}`;
}
