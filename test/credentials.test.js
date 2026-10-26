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
		fetchImpl: async () => ({
			ok: true,
			json: async () => ({ data: { accessToken: "new", refreshToken: "r2", expiresAt: future() } }),
		}),
	});
	assert.equal(await store.getAccessToken(), "workos:new");
	const disk = await loadCredentials();
	assert.equal(disk.accessToken, "new");
	assert.equal(disk.refreshToken, "r2");
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
			return { ok: true, json: async () => ({ data: { accessToken: "fresh", refreshToken: "r2", expiresAt: future() } }) };
		},
	});
	assert.equal(await store.getAccessToken(), "workos:fresh");
	assert.equal(calls, 1);
});
