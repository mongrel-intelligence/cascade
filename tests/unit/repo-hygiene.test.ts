import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');

function readRoot(filePath: string): string {
	return readFileSync(path.join(ROOT, filePath), 'utf-8');
}

describe('open-source readiness', () => {
	describe('LICENSE', () => {
		it('exists at repo root', () => {
			expect(existsSync(path.join(ROOT, 'LICENSE'))).toBe(true);
		});

		it('is MIT license', () => {
			const content = readRoot('LICENSE');
			expect(content).toContain('MIT License');
		});

		it('includes copyright holder', () => {
			const content = readRoot('LICENSE');
			expect(content).toContain('Zbigniew Sobiecki');
			expect(content).toContain('CASCADE Contributors');
		});
	});

	describe('CONTRIBUTING.md', () => {
		it('exists at repo root', () => {
			expect(existsSync(path.join(ROOT, 'CONTRIBUTING.md'))).toBe(true);
		});

		it('covers key sections', () => {
			const content = readRoot('CONTRIBUTING.md');
			expect(content).toContain('Prerequisites');
			expect(content).toContain('Development Setup');
			expect(content).toContain('Running Tests');
			expect(content).toContain('Code Style');
			expect(content).toContain('Commit Messages');
			expect(content).toContain('Pull Request Workflow');
		});

		it('mentions Conventional Commits', () => {
			const content = readRoot('CONTRIBUTING.md');
			expect(content).toContain('Conventional Commits');
		});
	});

	describe('CODE_OF_CONDUCT.md', () => {
		it('exists at repo root', () => {
			expect(existsSync(path.join(ROOT, 'CODE_OF_CONDUCT.md'))).toBe(true);
		});

		it('references Contributor Covenant', () => {
			const content = readRoot('CODE_OF_CONDUCT.md');
			expect(content).toContain('Contributor Covenant');
		});
	});

	describe('SECURITY.md', () => {
		it('exists at repo root', () => {
			expect(existsSync(path.join(ROOT, 'SECURITY.md'))).toBe(true);
		});

		it('documents reporting process', () => {
			const content = readRoot('SECURITY.md');
			expect(content).toContain('Security Advisories');
		});

		it('documents security features', () => {
			const content = readRoot('SECURITY.md');
			expect(content).toContain('AES-256-GCM');
			expect(content).toContain('Dual-persona');
		});
	});

	describe('GitHub community files', () => {
		it('has bug report issue template', () => {
			expect(existsSync(path.join(ROOT, '.github/ISSUE_TEMPLATE/bug_report.yml'))).toBe(true);
		});

		it('has feature request issue template', () => {
			expect(existsSync(path.join(ROOT, '.github/ISSUE_TEMPLATE/feature_request.yml'))).toBe(true);
		});

		it('has pull request template', () => {
			expect(existsSync(path.join(ROOT, '.github/pull_request_template.md'))).toBe(true);
		});

		it('has CODEOWNERS', () => {
			expect(existsSync(path.join(ROOT, '.github/CODEOWNERS'))).toBe(true);
		});
	});

	describe('package.json hygiene', () => {
		const pkg = JSON.parse(readRoot('package.json'));

		it('has a description that reflects multi-PM support', () => {
			expect(pkg.description).not.toContain('Trello-to-Code');
			expect(pkg.description.toLowerCase()).toContain('pm-to-code');
		});

		it('declares MIT license', () => {
			expect(pkg.license).toBe('MIT');
		});

		it('does not use "latest" for any dependency', () => {
			const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
			for (const [name, version] of Object.entries(allDeps)) {
				expect(version, `${name} should not use "latest"`).not.toBe('latest');
			}
		});

		it('requires Node.js 22+', () => {
			expect(pkg.engines.node).toBe('>=22.0.0');
		});
	});

	describe('.gitignore', () => {
		it('ignores .squint.db', () => {
			const content = readRoot('.gitignore');
			expect(content).toContain('.squint.db');
		});
	});

	describe('config/projects.json', () => {
		const config = JSON.parse(readRoot('config/projects.json'));

		it('has a comment explaining the file is a seeding example', () => {
			expect(config._comment).toBeDefined();
			expect(config._comment.toLowerCase()).toContain('seeding example');
		});

		it('does not contain real Trello board IDs', () => {
			const content = readRoot('config/projects.json');
			// Real Trello IDs are 24-char hex strings
			const hexIdPattern = /[0-9a-f]{24}/;
			expect(content).not.toMatch(hexIdPattern);
		});

		it('uses placeholder repo names', () => {
			for (const project of config.projects) {
				expect(project.repo).not.toMatch(/mongrel-intelligence/);
			}
		});
	});

	describe('CI configuration', () => {
		it('includes npm audit step', () => {
			const content = readRoot('.github/workflows/ci.yml');
			expect(content).toContain('npm audit');
		});
	});

	describe('committed artifacts are removed', () => {
		it('.squint.db is not present', () => {
			expect(existsSync(path.join(ROOT, '.squint.db'))).toBe(false);
		});

		it('tmp-test.sh is not present', () => {
			expect(existsSync(path.join(ROOT, 'tmp-test.sh'))).toBe(false);
		});
	});
});
