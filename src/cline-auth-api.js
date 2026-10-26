import { CLINE_API_BASE } from "./auth.js";
import { clineHeaders } from "./index.js";

export class FreeLimitError extends Error {
	constructor(message, { retryAfter } = {}) {
		super(message);
		this.name = "FreeLimitError";
		this.retryAfter = retryAfter;
	}
}

const FREE_LIMIT_MARKERS = ["free limit reached on model", "free limit reached"];

export function extractRetryHint(message) {
	const m = /try again in ([^.]+)/i.exec(String(message ?? ""));
	return m?.[1]?.trim();
}

export function isFreeLimitMessage(message) {
	const s = String(message ?? "").toLowerCase();
	return FREE_LIMIT_MARKERS.some((x) => s.includes(x));
}

export function classifyClineError(status, body) {
	const text = typeof body === "string" ? body : JSON.stringify(body ?? {});
	if (isFreeLimitMessage(text)) return new FreeLimitError(text.slice(0, 500), { retryAfter: extractRetryHint(text) });
	return undefined;
}

export function workosBearer(accessToken) {
	return accessToken.startsWith("workos:") ? accessToken : `workos:${accessToken}`;
}

export async function exchangeAccessToken(accessToken, { apiBase = CLINE_API_BASE, fetchImpl = fetch } = {}) {
	const res = await fetchImpl(`${apiBase}/auth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...clineHeaders(), Authorization: `Bearer ${workosBearer(accessToken)}` },
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(`Token exchange failed (${res.status}): ${body.error ?? body.message ?? "unknown"}`);
	}
	return body;
}

export async function refreshClineToken(refreshToken, { apiBase = CLINE_API_BASE, fetchImpl = fetch } = {}) {
	const res = await fetchImpl(`${apiBase}/auth/refresh`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...clineHeaders() },
		body: JSON.stringify({ refreshToken, grantType: "refresh_token" }),
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body?.data?.accessToken) {
		throw new Error(`Token refresh failed (${res.status}): ${body?.error ?? "no accessToken"}`);
	}
	return body.data;
}
