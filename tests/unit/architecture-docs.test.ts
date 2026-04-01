import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DOCS_ROOT = path.resolve(__dirname, '../../docs');
const ARCH_DIR = path.join(DOCS_ROOT, 'architecture');

function readDoc(filePath: string): string {
	return readFileSync(filePath, 'utf-8');
}

function extractMarkdownLinks(content: string): string[] {
	const linkPattern = /\[.*?\]\((\.\.?\/[^)]+\.md)\)/g;
	return Array.from(content.matchAll(linkPattern), (m) => m[1]);
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
				const resolved = path.resolve(DOCS_ROOT, link);
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
					const resolved = path.resolve(ARCH_DIR, link);
					expect(existsSync(resolved)).toBe(true);
				}
			}
		});
	});
});
