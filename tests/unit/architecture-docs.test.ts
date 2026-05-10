import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { TRIGGER_EVENTS } from '../../src/triggers/shared/events.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const DOCS_ROOT = path.resolve(__dirname, '../../docs');
const ARCH_DIR = path.join(DOCS_ROOT, 'architecture');
const ROOT_DOCS = ['README.md', 'CLAUDE.md', 'AGENTS.md'];
const EXTRA_ACTIVE_DOCS = [
	'src/integrations/README.md',
	'src/gadgets/README.md',
	'src/backends/README.md',
	'tests/README.md',
];

function readDoc(filePath: string): string {
	return readFileSync(filePath, 'utf-8');
}

function extractMarkdownLinks(content: string): string[] {
	const linkPattern = /\[[^\]]+\]\((\.\.?\/[^)\s]+\.md(?:\.done)?(?:#[^)]+)?)\)/g;
	return Array.from(content.matchAll(linkPattern), (m) => m[1]);
}

function listMarkdownDocs(dir: string): string[] {
	const entries = readdirSync(dir);
	return entries.flatMap((entry) => {
		const fullPath = path.join(dir, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) return listMarkdownDocs(fullPath);
		if (entry.endsWith('.md')) return [fullPath];
		return [];
	});
}

function activeMarkdownDocs(): string[] {
	return [
		...ROOT_DOCS.map((file) => path.join(REPO_ROOT, file)),
		...EXTRA_ACTIVE_DOCS.map((file) => path.join(REPO_ROOT, file)),
		...listMarkdownDocs(DOCS_ROOT),
	];
}

function resolveMarkdownLink(fromFile: string, link: string): string {
	const [target] = link.split('#');
	return path.resolve(path.dirname(fromFile), target);
}

describe('Architecture documentation', () => {
	describe('hub document (ARCHITECTURE.md)', () => {
		const hubPath = path.join(DOCS_ROOT, 'ARCHITECTURE.md');

		it('exists', () => {
			expect(existsSync(hubPath)).toBe(true);
		});

		it('contains expected sections', () => {
			const content = readDoc(hubPath);
			const expectedSections = [
				'System Overview',
				'Service Topology',
				'End-to-End Request Flow',
				'Architectural Patterns',
				'Directory Map',
				'Deep-Dive Documents',
			];
			for (const section of expectedSections) {
				expect(content).toContain(section);
			}
		});

		it('contains mermaid diagrams', () => {
			const content = readDoc(hubPath);
			expect(content).toContain('```mermaid');
		});

		it('links to all 10 deep-dive documents', () => {
			const content = readDoc(hubPath);
			const deepDiveFiles = [
				'01-services.md',
				'02-webhook-pipeline.md',
				'03-trigger-system.md',
				'04-agent-system.md',
				'05-engine-backends.md',
				'06-integration-layer.md',
				'07-gadgets.md',
				'08-config-credentials.md',
				'09-database.md',
				'10-resilience.md',
			];
			for (const file of deepDiveFiles) {
				expect(content).toContain(file);
			}
		});
	});

	const deepDiveDocuments = [
		{
			file: '01-services.md',
			expectedHeading: 'Services and Deployment',
			expectedSections: ['Router', 'Worker', 'Dashboard'],
		},
		{
			file: '02-webhook-pipeline.md',
			expectedHeading: 'Webhook Pipeline',
			expectedSections: ['Webhook Handler Factory', 'Platform Adapters'],
		},
		{
			file: '03-trigger-system.md',
			expectedHeading: 'Trigger System',
			expectedSections: ['TriggerRegistry', 'TriggerHandler', 'Built-in Triggers'],
		},
		{
			file: '04-agent-system.md',
			expectedHeading: 'Agent System',
			expectedSections: ['Agent Definitions', 'Capabilities', 'Prompts'],
		},
		{
			file: '05-engine-backends.md',
			expectedHeading: 'Engine Backends',
			expectedSections: ['AgentEngine Interface', 'Execution Adapter'],
		},
		{
			file: '06-integration-layer.md',
			expectedHeading: 'Integration Layer',
			expectedSections: ['IntegrationModule', 'IntegrationRegistry'],
		},
		{
			file: '07-gadgets.md',
			expectedHeading: 'Gadgets',
			expectedSections: ['Capability-to-Gadget Mapping', 'Built-in Gadgets'],
		},
		{
			file: '08-config-credentials.md',
			expectedHeading: 'Configuration and Credentials',
			expectedSections: ['Config Provider', 'Credential Resolution'],
		},
		{
			file: '09-database.md',
			expectedHeading: 'Database',
			expectedSections: ['Schema', 'Repositories'],
		},
		{
			file: '10-resilience.md',
			expectedHeading: 'Resilience',
			expectedSections: ['Watchdog', 'Concurrency Controls'],
		},
	];

	describe.each(deepDiveDocuments)('$file', ({ file, expectedHeading, expectedSections }) => {
		const filePath = path.join(ARCH_DIR, file);

		it('exists', () => {
			expect(existsSync(filePath)).toBe(true);
		});

		it(`contains heading: ${expectedHeading}`, () => {
			const content = readDoc(filePath);
			expect(content).toContain(expectedHeading);
		});

		it('contains expected sections', () => {
			const content = readDoc(filePath);
			for (const section of expectedSections) {
				expect(content).toContain(section);
			}
		});
	});

	describe('cross-references', () => {
		it('all relative .md links in hub document resolve to existing files', () => {
			const hubPath = path.join(DOCS_ROOT, 'ARCHITECTURE.md');
			const content = readDoc(hubPath);
			const links = extractMarkdownLinks(content);

			expect(links.length).toBeGreaterThan(0);
			for (const link of links) {
				const resolved = resolveMarkdownLink(hubPath, link);
				expect(existsSync(resolved)).toBe(true);
			}
		});

		it('all relative .md links in deep-dive documents resolve to existing files', () => {
			for (const { file } of deepDiveDocuments) {
				const filePath = path.join(ARCH_DIR, file);
				if (!existsSync(filePath)) continue;
				const content = readDoc(filePath);
				const links = extractMarkdownLinks(content);
				for (const link of links) {
					const resolved = resolveMarkdownLink(filePath, link);
					expect(existsSync(resolved)).toBe(true);
				}
			}
		});

		it('all relative .md and .md.done links in active docs resolve to existing files', () => {
			for (const filePath of activeMarkdownDocs()) {
				const links = extractMarkdownLinks(readDoc(filePath));
				for (const link of links) {
					const resolved = resolveMarkdownLink(filePath, link);
					expect(existsSync(resolved), `${filePath} links to missing ${link}`).toBe(true);
				}
			}
		});
	});

	describe('canonical documentation facts', () => {
		it('uses the canonical alerting issue trigger event in active docs', () => {
			const staleEvent = 'alerting:issue-created';
			for (const filePath of activeMarkdownDocs()) {
				const content = readDoc(filePath);
				expect(content, `${filePath} should not mention ${staleEvent}`).not.toContain(staleEvent);
			}
			expect(TRIGGER_EVENTS.ALERTING.ISSUE_ALERT).toBe('alerting:issue-alert');
		});

		it('documents current cascade-tools namespaces and work-item terminology', () => {
			const stalePatterns = [
				/cascade-tools\s+github\b/,
				/cascade-tools\s+sentry\b/,
				/\bread-card\b/,
				/\blist-cards\b/,
				/\bupdate-card\b/,
				/--cardId\b/,
				/\bwork_items\b/,
			];

			for (const filePath of activeMarkdownDocs()) {
				const content = readDoc(filePath);
				for (const pattern of stalePatterns) {
					expect(content, `${filePath} should not match ${pattern}`).not.toMatch(pattern);
				}
			}
		});

		it('keeps AGENTS.md synchronized with CLAUDE.md', () => {
			const agents = readDoc(path.join(REPO_ROOT, 'AGENTS.md'));
			const claude = readDoc(path.join(REPO_ROOT, 'CLAUDE.md'));
			expect(agents).toBe(claude);
		});

		it('documents friction reporting operator and provider contracts', () => {
			const requiredFacts = [
				'lists.friction',
				'statuses.friction',
				'ReportFriction',
				'cascade-tools pm report-friction',
				'--details-file -',
				'createWorkItem',
				'moveWorkItem',
				'friction_slot_missing',
				'friction_sidecar_drain_failed',
			];
			const docs = [
				path.join(ARCH_DIR, '07-gadgets.md'),
				path.join(ARCH_DIR, '08-config-credentials.md'),
				path.join(ARCH_DIR, '10-resilience.md'),
				path.join(REPO_ROOT, 'src/integrations/README.md'),
				path.join(REPO_ROOT, 'src/gadgets/README.md'),
				path.join(REPO_ROOT, 'CLAUDE.md'),
				path.join(REPO_ROOT, 'AGENTS.md'),
				path.join(REPO_ROOT, 'CHANGELOG.md'),
			];
			const combined = docs.map(readDoc).join('\n');

			for (const fact of requiredFacts) {
				expect(combined, `friction docs should mention ${fact}`).toContain(fact);
			}
		});
	});
});
