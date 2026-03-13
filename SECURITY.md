# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use [GitHub Security Advisories](https://github.com/zbigniewsobiecki/cascade/security/advisories/new) to report vulnerabilities privately. You should receive a response within 72 hours.

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

## Security Design

CASCADE incorporates several security measures:

- **Credential encryption at rest**: AES-256-GCM encryption for all stored credentials when `CREDENTIAL_MASTER_KEY` is configured. See [CLAUDE.md](./CLAUDE.md#credential-encryption-at-rest) for details.
- **Dual-persona model**: Separate GitHub bot accounts for implementation and review prevent self-approval and feedback loops.
- **No env var fallback for secrets**: All project credentials are stored in the database — no secrets in environment variables or config files.
- **Session-based auth**: HTTP-only cookies with bcrypt password hashing for dashboard access.
- **CI security scanning**: `npm audit` runs in CI to catch known dependency vulnerabilities.
