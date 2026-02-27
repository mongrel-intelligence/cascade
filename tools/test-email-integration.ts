#!/usr/bin/env npx tsx
/**
 * Test script for email integration with Gmail
 *
 * Usage:
 *   npx tsx tools/test-email-integration.ts --username your@gmail.com --password "your-app-password"
 *
 * Prerequisites:
 *   1. Enable 2FA on your Google account
 *   2. Generate an App Password: https://myaccount.google.com/apppasswords
 *   3. Use the 16-character app password (no spaces) as --password
 *
 * What it tests:
 *   1. IMAP connection (search emails)
 *   2. Read a specific email
 *   3. Send a test email (to yourself)
 *   4. Search for the sent email
 *   5. Reply to the email
 */

import { parseArgs } from 'node:util';
import { ImapEmailProvider } from '../src/email/imap/adapter.js';
import type { EmailSummary, PasswordEmailCredentials } from '../src/email/types.js';

const { values } = parseArgs({
	options: {
		username: { type: 'string', short: 'u' },
		password: { type: 'string', short: 'p' },
		'skip-send': { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h' },
	},
});

if (values.help) {
	console.log(`
Email Integration Test Script

Usage:
  npx tsx tools/test-email-integration.ts --username <email> --password <app-password>

Options:
  -u, --username    Gmail address (e.g., you@gmail.com)
  -p, --password    Gmail App Password (16 chars, no spaces)
  --skip-send       Skip send/reply tests (read-only mode)
  -h, --help        Show this help

Prerequisites:
  1. Enable 2FA on your Google account
  2. Generate an App Password: https://myaccount.google.com/apppasswords
  3. Use the 16-character app password (spaces removed)
`);
	process.exit(0);
}

if (!values.username || !values.password) {
	console.error('Error: --username and --password are required');
	console.error('Run with --help for usage');
	process.exit(1);
}

const credentials: PasswordEmailCredentials = {
	authMethod: 'password',
	imapHost: 'imap.gmail.com',
	imapPort: 993,
	smtpHost: 'smtp.gmail.com',
	smtpPort: 587,
	username: values.username,
	password: values.password,
};

function getRecentDateString(): string {
	const since = new Date();
	since.setDate(since.getDate() - 7);
	return since.toISOString().split('T')[0];
}

function extractUid(results: EmailSummary[]): number | null {
	return results.length > 0 ? results[0].uid : null;
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
	console.log(name);
	console.log('-'.repeat(60));
	try {
		await fn();
	} catch (err) {
		console.error('FAILED:', err instanceof Error ? err.message : err);
	}
	console.log();
}

async function testSearchRecentEmails(provider: ImapEmailProvider): Promise<EmailSummary[]> {
	const results = await provider.searchEmails('INBOX', { since: getRecentDateString() }, 5);
	for (const email of results) {
		console.log(
			`[UID:${email.uid}] ${email.date.toISOString()} - ${email.from} - ${email.subject}`,
		);
	}
	return results;
}

async function testReadFirstEmail(provider: ImapEmailProvider): Promise<number | null> {
	const results = await provider.searchEmails('INBOX', { since: getRecentDateString() }, 1);
	const firstUid = extractUid(results);
	if (firstUid) {
		console.log(`Reading email UID: ${firstUid}`);
		const email = await provider.readEmail('INBOX', firstUid);
		console.log(email);
	} else {
		console.log('No emails found to read');
	}
	return firstUid;
}

async function testSendEmail(provider: ImapEmailProvider, toAddress: string): Promise<void> {
	const result = await provider.sendEmail({
		to: [toAddress],
		subject: `CASCADE Email Test - ${new Date().toISOString()}`,
		body: `This is a test email from CASCADE email integration.

Sent at: ${new Date().toISOString()}

If you receive this, the SMTP integration is working correctly.`,
	});
	console.log(result);
}

async function testSearchSentEmail(provider: ImapEmailProvider): Promise<number | null> {
	const results = await provider.searchEmails('INBOX', { subject: 'CASCADE Email Test' }, 5);
	for (const email of results) {
		console.log(
			`[UID:${email.uid}] ${email.date.toISOString()} - ${email.from} - ${email.subject}`,
		);
	}
	return extractUid(results);
}

async function testReplyToEmail(provider: ImapEmailProvider, uid: number): Promise<void> {
	const result = await provider.replyToEmail({
		folder: 'INBOX',
		uid,
		body: `This is an automated reply from CASCADE.

The reply functionality is working correctly.

Original email UID: ${uid}`,
		replyAll: false,
	});
	console.log(result);
}

async function runAllTests(provider: ImapEmailProvider): Promise<void> {
	await runTest('TEST 1: Search recent emails (INBOX, last 7 days)', () =>
		testSearchRecentEmails(provider),
	);

	await runTest('TEST 2: Read first email from search', async () => {
		await testReadFirstEmail(provider);
	});

	if (values['skip-send']) {
		console.log('SKIPPED: Send/reply tests (--skip-send flag)');
		console.log();
		return;
	}

	await runTest('TEST 3: Send test email to yourself', async () => {
		await testSendEmail(provider, credentials.username);
	});

	console.log('Waiting 5 seconds for email to arrive...');
	await new Promise((resolve) => setTimeout(resolve, 5000));
	console.log();

	let sentUid: number | null = null;
	await runTest('TEST 4: Search for sent email', async () => {
		sentUid = await testSearchSentEmail(provider);
	});

	await runTest('TEST 5: Reply to the test email', async () => {
		if (sentUid) {
			await testReplyToEmail(provider, sentUid);
		} else {
			console.log('SKIPPED: No email UID available to reply to');
		}
	});
}

async function main(): Promise<void> {
	console.log('='.repeat(60));
	console.log('Email Integration Test');
	console.log('='.repeat(60));
	console.log(`Username: ${credentials.username}`);
	console.log(`IMAP: ${credentials.imapHost}:${credentials.imapPort}`);
	console.log(`SMTP: ${credentials.smtpHost}:${credentials.smtpPort}`);
	console.log('='.repeat(60));
	console.log();

	const provider = new ImapEmailProvider(credentials);
	await runAllTests(provider);

	console.log('='.repeat(60));
	console.log('Test complete!');
	console.log('='.repeat(60));
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
