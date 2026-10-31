import { CLINE_API_BASE, WORKOS_BASE, WORKOS_CLIENT_ID } from "./auth.js";
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

export function decodeJwtClaims(token) {
	try {
		const parts = String(token).split(".");
		if (parts.length !== 3) return undefined;
		return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
	} catch {
		return undefined;
	}
}

export function describeJwt(token) {
	const claims = decodeJwtClaims(token);
	if (!claims) return {};
	return {
		expiresAt: typeof claims.exp === "number" ? new Date(claims.exp * 1000).toISOString() : undefined,
		userInfo: { email: claims.email, id: claims.sub, firstName: claims.firstName },
	};
}

export async function refreshClineToken(refreshToken, { workosBase = WORKOS_BASE, clientId = WORKOS_CLIENT_ID, fetchImpl = fetch } = {}) {
	const res = await fetchImpl(`${workosBase}/user_management/authenticate`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: clientId,
		}),
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body?.access_token) {
		throw new Error(`Token refresh failed (${res.status}): ${body?.error_description ?? body?.error ?? "no access_token"}`);
	}
	const jwt = describeJwt(body.access_token);
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token ?? refreshToken,
		tokenType: body.token_type ?? "Bearer",
		expiresAt: jwt.expiresAt,
		userInfo: jwt.userInfo,
	};
}
