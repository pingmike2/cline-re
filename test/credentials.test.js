import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CredentialStore } from "../src/credentials.js";
import { saveCredentials, loadCredentials, removeCredentials } from "../src/auth.js";

async function isolate() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clinere-cred-"));
	process.env.CLINE_DATA_DIR = dir;
	return dir;
}

const future = () => new Date(Date.now() + 3600_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

function fakeJwt(expEpoch, email = "x@y.z") {
	const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
	return `${enc({ alg: "RS256" })}.${enc({ email, sub: "user_1", exp: expEpoch })}.sig`;
}

const workosOk = ({ accessToken, refreshToken }) => ({
	ok: true,
	json: async () => ({ access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer" }),
});

test("whoami fields persist and reload", async () => {
	await isolate();
	await saveCredentials({ provider: "cline", accessToken: "a", refreshToken: "r", expiresAt: future(), userInfo: { email: "x@y.z" } });
	const back = await loadCredentials();
	assert.equal(back.userInfo.email, "x@y.z");
	await removeCredentials();
	assert.equal(await loadCredentials(), undefined);
});

test("fresh token is returned with workos: prefix and never refreshed", async () => {
	await isolate();
	await saveCredentials({ accessToken: "abc", refreshToken: "r", expiresAt: future() });
	let calls = 0;
	const store = new CredentialStore({ fetchImpl: async () => { calls += 1; throw new Error("should not refresh"); } });
	assert.equal(await store.getAccessToken(), "workos:abc");
	assert.equal(calls, 0);
});

test("stale token triggers refresh and persists rotated refresh token", async () => {
	await isolate();
	await saveCredentials({ accessToken: "old", refreshToken: "r1", expiresAt: past() });
	const store = new CredentialStore({
		fetchImpl: async () => workosOk({ accessToken: fakeJwt(Math.floor(Date.now() / 1000) + 3600), refreshToken: "r2" }),
	});
	const fresh = await store.getAccessToken();
	assert.ok(fresh.startsWith("workos:"));
	const disk = await loadCredentials();
	assert.equal(disk.accessToken, fresh.slice("workos:".length));
	assert.equal(disk.refreshToken, "r2");
	assert.equal(disk.userInfo?.email, "x@y.z");
	assert.ok(Date.parse(disk.expiresAt) > Date.now());
});

test("already-prefixed token is not double-prefixed", async () => {
	await isolate();
	await saveCredentials({ accessToken: "workos:zzz", refreshToken: "r", expiresAt: future() });
	const store = new CredentialStore();
	assert.equal(await store.getAccessToken(), "workos:zzz");
});

test("missing credentials raise a login hint", async () => {
	await isolate();
	const store = new CredentialStore();
	await assert.rejects(() => store.getAccessToken(), /run `cline-re login`/);
});

test("expiry within skew window is treated as stale", async () => {
	await isolate();
	await saveCredentials({ accessToken: "soon", refreshToken: "r", expiresAt: new Date(Date.now() + 30_000).toISOString() });
	let calls = 0;
	const store = new CredentialStore({
		fetchImpl: async () => {
			calls += 1;
			return workosOk({ accessToken: fakeJwt(Math.floor(Date.now() / 1000) + 3600), refreshToken: "r2" });
		},
	});
	assert.ok((await store.getAccessToken()).startsWith("workos:"));
	assert.equal(calls, 1);
});

test("refresh posts a WorkOS refresh_token grant, not the dead cline endpoint", async () => {
	await isolate();
	await saveCredentials({ accessToken: "old", refreshToken: "r1", expiresAt: past() });
	const seen = [];
	const store = new CredentialStore({
		fetchImpl: async (url, init) => {
			seen.push({ url, init });
			return workosOk({ accessToken: fakeJwt(Math.floor(Date.now() / 1000) + 3600), refreshToken: "r2" });
		},
	});
	await store.getAccessToken();
	assert.equal(seen.length, 1);
	assert.match(seen[0].url, /api\.workos\.com\/user_management\/authenticate$/);
	assert.doesNotMatch(seen[0].url, /api\.cline\.bot/);
	assert.match(seen[0].init.headers["Content-Type"], /x-www-form-urlencoded/);
	const body = new URLSearchParams(seen[0].init.body.toString());
	assert.equal(body.get("grant_type"), "refresh_token");
	assert.equal(body.get("refresh_token"), "r1");
	assert.ok(body.get("client_id"));
});

test("refresh derives expiresAt and email from the JWT, falling back to the old refresh token", async () => {
	await isolate();
	await saveCredentials({ accessToken: "old", refreshToken: "r1", expiresAt: past() });
	const exp = Math.floor(Date.now() / 1000) + 7200;
	const store = new CredentialStore({ fetchImpl: async () => workosOk({ accessToken: fakeJwt(exp, "a@b.c"), refreshToken: undefined }) });
	await store.getAccessToken();
	const disk = await loadCredentials();
	assert.equal(disk.expiresAt, new Date(exp * 1000).toISOString());
	assert.equal(disk.userInfo?.email, "a@b.c");
	assert.equal(disk.refreshToken, "r1");
});

test("refresh surfaces the WorkOS error description", async () => {
	await isolate();
	await saveCredentials({ accessToken: "old", refreshToken: "r1", expiresAt: past() });
	const store = new CredentialStore({
		fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "Refresh token is invalid" }) }),
	});
	await assert.rejects(() => store.getAccessToken(), /400.*Refresh token is invalid/);
});
