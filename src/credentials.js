import { loadCredentials, saveCredentials } from "./auth.js";
import { refreshClineToken, workosBearer } from "./cline-auth-api.js";

const EXPIRY_SKEW_MS = 60 * 1000;

export class CredentialStore {
	constructor({ fetchImpl = fetch, now = () => Date.now() } = {}) {
		this.fetchImpl = fetchImpl;
		this.now = now;
		this.cached = undefined;
	}

	async load() {
		if (this.cached) return this.cached;
		this.cached = await loadCredentials();
		return this.cached;
	}

	isFresh(creds) {
		if (!creds?.accessToken) return false;
		if (!creds.expiresAt) return false;
		const exp = Date.parse(creds.expiresAt);
		if (Number.isNaN(exp)) return false;
		return exp - this.now() > EXPIRY_SKEW_MS;
	}

	async getAccessToken() {
		const creds = await this.load();
		if (!creds?.refreshToken) {
			throw Object.assign(new Error("not logged in: run `cline-re login`"), { code: "ENOTLOGGEDIN" });
		}
		if (this.isFresh(creds)) return workosBearer(creds.accessToken);
		return this.refresh();
	}

	async refresh() {
		const creds = await this.load();
		if (!creds?.refreshToken) {
			throw Object.assign(new Error("not logged in: run `cline-re login`"), { code: "ENOTLOGGEDIN" });
		}
		const data = await refreshClineToken(creds.refreshToken, { fetchImpl: this.fetchImpl });
		const next = {
			...creds,
			accessToken: data.accessToken,
			refreshToken: data.refreshToken ?? creds.refreshToken,
			expiresAt: data.expiresAt,
			tokenType: data.tokenType ?? "Bearer",
			userInfo: data.userInfo ? { ...creds.userInfo, ...data.userInfo } : creds.userInfo,
			updatedAt: new Date(this.now()).toISOString(),
		};
		this.cached = next;
		await saveCredentials(next);
		return workosBearer(next.accessToken);
	}
}
