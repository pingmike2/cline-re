import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./session.js";

export const WORKOS_BASE = "https://api.workos.com";
export const WORKOS_CLIENT_ID = "client_01K3A541FN8TA3EPPHTD2325AR";
export const CLINE_API_BASE = "https://api.cline.bot/api/v1";

const DEVICE_AUTH = "/user_management/authorize/device";
const AUTHENTICATE = "/user_management/authenticate";

export function credentialsPath() {
	return path.join(dataDir(), "credentials.json");
}

export async function saveCredentials(creds) {
	const file = credentialsPath();
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(`${file}.tmp`, JSON.stringify(creds, null, 2), { mode: 0o600 });
	await fs.rename(`${file}.tmp`, file);
	return file;
}

export async function loadCredentials() {
	try {
		return JSON.parse(await fs.readFile(credentialsPath(), "utf8"));
	} catch {
		return undefined;
	}
}

export async function removeCredentials() {
	await fs.rm(credentialsPath(), { force: true });
}

export async function startDeviceAuthorization({ clientId = WORKOS_CLIENT_ID } = {}) {
	const res = await fetch(`${WORKOS_BASE}${DEVICE_AUTH}`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ client_id: clientId }),
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(`Device authorization failed: ${res.status} ${body.error_description ?? ""}`.trim());
	}
	return {
		deviceCode: body.device_code,
		userCode: body.user_code,
		verificationUri: body.verification_uri,
		verificationUriComplete: body.verification_uri_complete,
		expiresIn: body.expires_in ?? 300,
		interval: body.interval ?? 5,
	};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pollDeviceToken({ deviceCode, expiresIn, interval, clientId = WORKOS_CLIENT_ID, signal }) {
	const deadline = Date.now() + expiresIn * 1000;
	let wait = Math.max(1, interval);

	while (Date.now() < deadline) {
		if (signal?.aborted) throw new Error("authorization cancelled");
		const res = await fetch(`${WORKOS_BASE}${AUTHENTICATE}`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				device_code: deviceCode,
				client_id: clientId,
			}),
			signal,
		});
		const body = await res.json().catch(() => ({}));
		if (res.ok) {
			if (!body.access_token || !body.refresh_token) throw new Error("Invalid WorkOS token response");
			return { accessToken: body.access_token, refreshToken: body.refresh_token, tokenType: body.token_type ?? "Bearer" };
		}
		if (body.error === "authorization_pending") {
			await sleep(wait * 1000);
			continue;
		}
		if (body.error === "slow_down") {
			wait += 1;
			await sleep(wait * 1000);
			continue;
		}
		if (body.error === "expired_token") throw new Error("device code expired, run login again");
		if (body.error === "access_denied") throw new Error("authorization denied");
		throw new Error(`Authentication failed: ${body.error ?? res.status}`);
	}
	throw new Error("device code expired, run login again");
}
