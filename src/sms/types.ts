/**
 * SMS domain types for the Twilio SMS integration.
 */

export interface SmsCredentials {
	accountSid: string;
	authToken: string;
	phoneNumber: string;
}

export interface SendSmsOptions {
	to: string;
	body: string;
}

export interface SendSmsResult {
	sid: string;
	status: string;
}
