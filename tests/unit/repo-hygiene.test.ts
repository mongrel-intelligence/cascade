import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';
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

		it('root and web/ share the same zod major', () => {
			// web/tsconfig.json compiles ../src/api and ../src/db; if the majors diverge,
			// z.infer<> silently computes different types in backend vs frontend compilation.
			const webPkg = JSON.parse(readRoot('web/package.json'));
			const major = (range: string) => range.replace(/^[^\d]*/, '').split('.')[0];
			expect(major(webPkg.dependencies.zod), 'bump zod in root and web/ together').toBe(
				major(pkg.dependencies.zod),
			);
		});
	});

	describe('npm overrides', () => {
		type LockEntry = {
			version?: string;
			dev?: boolean;
			dependencies?: Record<string, string>;
			optionalDependencies?: Record<string, string>;
			peerDependencies?: Record<string, string>;
		};

		// A version's compatibility line: its major, or its minor while still 0.x.
		const releaseLine = (version: string) =>
			semver.major(version) > 0 ? `${semver.major(version)}.x` : `0.${semver.minor(version)}.x`;

		// Node module resolution: the nearest node_modules/<name>, walking up from the dependent.
		function resolveInstalled(
			packages: Record<string, LockEntry>,
			dependentPath: string,
			name: string,
		): LockEntry | undefined {
			const candidates: string[] = [];
			let dir = dependentPath;
			while (dir) {
				candidates.push(`${dir}/node_modules/${name}`);
				const parentEnd = dir.lastIndexOf('/node_modules/');
				dir = parentEnd === -1 ? '' : dir.slice(0, parentEnd);
			}
			candidates.push(`node_modules/${name}`);
			return candidates.map((candidate) => packages[candidate]).find(Boolean);
		}

		function offLineOverrides(dir: string): string[] {
			const overrides = JSON.parse(readRoot(path.join(dir, 'package.json'))).overrides ?? {};
			const { packages } = JSON.parse(readRoot(path.join(dir, 'package-lock.json'))) as {
				packages: Record<string, LockEntry>;
			};

			return Object.entries(packages)
				.filter(([, entry]) => !entry.dev)
				.flatMap(([dependentPath, entry]) =>
					Object.entries({
						...entry.dependencies,
						...entry.optionalDependencies,
						...entry.peerDependencies,
					})
						.filter(([name]) => name in overrides)
						.flatMap(([name, range]) => {
							const installed = resolveInstalled(packages, dependentPath, name)?.version;
							return installed && !semver.intersects(range, releaseLine(installed))
								? [`${dependentPath} declares ${name}@${range}, override installs ${installed}`]
								: [];
						}),
				);
		}

		it.each([
			{ workspace: 'root', dir: '.' },
			{ workspace: 'web/', dir: 'web' },
		])('$workspace: never move a production package off a release line its dependents declare', ({
			dir,
		}) => {
			expect(offLineOverrides(dir)).toEqual([]);
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
		const PROD_AUDIT = 'npm audit --omit=dev --audit-level=high';
		const ciRunLines = () =>
			readRoot('.github/workflows/ci.yml')
				.split('\n')
				.map((line) => line.trim());

		it('gates root production dependencies on high-severity advisories', () => {
			expect(ciRunLines()).toContain(`run: ${PROD_AUDIT}`);
		});

		it('gates web/ production dependencies on high-severity advisories', () => {
			expect(ciRunLines()).toContain(`run: cd web && ${PROD_AUDIT}`);
		});

		it('builds the self-hosted image, not only the router and worker ones', () => {
			// The self-hosted Dockerfile is what single-tenant deployments build on their
			// own host; a break there only surfaced at deploy time until CI covered it.
			expect(ciRunLines().some((line) => line.includes('-f Dockerfile.selfhosted'))).toBe(true);
		});
	});

	describe('Dockerfile tool dependencies', () => {
		// `npx <tool>` inside an image build can only run what `npm ci` installed at the
		// root. A tool that exists solely as a nested copy under another package (or not
		// at all) fails the build with "<tool>: not found" — which is exactly how the
		// self-hosted image broke when an override stopped hoisting esbuild. Self-install
		// forms (`npx --yes <pkg>@<version>`) fetch their own copy and are exempt.
		const SHELL_FORM_RE = /\bnpx\s+(?!--yes\b|-y\b)([@a-z0-9][\w./-]*)/g;
		const EXEC_FORM_RE = /"npx",\s*"([^"]+)"/g;
		const dockerfiles = readdirSync(ROOT).filter((name) => name.startsWith('Dockerfile'));
		const pkg = JSON.parse(readRoot('package.json'));
		const declared: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
		const { packages: lock } = JSON.parse(readRoot('package-lock.json')) as {
			packages: Record<string, unknown>;
		};

		function npxTools(dockerfile: string): string[] {
			const text = readRoot(dockerfile);
			return [...text.matchAll(SHELL_FORM_RE), ...text.matchAll(EXEC_FORM_RE)]
				.map((match) => match[1])
				.filter((tool) => !tool.includes('@', 1));
		}

		it('finds the root Dockerfiles', () => {
			expect(dockerfiles).toContain('Dockerfile.selfhosted');
		});

		it.each(
			dockerfiles,
		)('%s: every `npx <tool>` is a declared dependency that npm ci installs at the root', (dockerfile) => {
			for (const tool of npxTools(dockerfile)) {
				expect(
					Object.hasOwn(declared, tool),
					`${dockerfile} runs \`npx ${tool}\` but package.json does not declare it`,
				).toBe(true);
				expect(
					Object.hasOwn(lock, `node_modules/${tool}`),
					`${dockerfile} runs \`npx ${tool}\` but package-lock.json has no root node_modules/${tool}`,
				).toBe(true);
			}
		});
	});

	describe('Docker build context', () => {
		it('excludes node_modules at every depth, not only at the root', () => {
			// `COPY web ./web` runs after the image's own `npm ci`; a host `web/node_modules`
			// in the context overlays a stale Vite/rolldown pair onto the clean install and
			// the web build dies loading vite.config.ts. A bare `node_modules` pattern only
			// matches the root directory.
			const patterns = readRoot('.dockerignore')
				.split('\n')
				.map((line) => line.trim());
			expect(patterns).toContain('**/node_modules');
		});
	});

	describe('committed artifacts are removed', () => {
		it('tmp-test.sh is not present', () => {
			expect(existsSync(path.join(ROOT, 'tmp-test.sh'))).toBe(false);
		});
	});
});
