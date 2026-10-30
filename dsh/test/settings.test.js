import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createKeyResolver, keyFilePath, normalizeConfig } from "../lib/settings.js";

function withHome(apiKey) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cline-settings-"));
	fs.writeFileSync(path.join(home, "cline.json"), JSON.stringify({ apiKey }), "utf8");
	return home;
}

test("the Configure form value wins over cline.json", async () => {
	const home = withHome("from-file");
	const env = { DSH_HOME: home };
	const resolve = createKeyResolver({ config: normalizeConfig({ apiKey: "from-form" }), env });
	assert.deepEqual(await resolve(), { apiKey: "from-form", source: "config" });
});

test("falls back to cline.json, then the environment variable", async () => {
	const home = withHome("from-file");
	const fromFile = createKeyResolver({ config: normalizeConfig({}), env: { DSH_HOME: home } });
	assert.deepEqual(await fromFile(), { apiKey: "from-file", source: "cline.json" });

	const empty = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cline-empty-"));
	const fromEnv = createKeyResolver({ config: normalizeConfig({}), env: { DSH_HOME: empty, CLINE_API_KEY: "from-env" } });
	assert.deepEqual(await fromEnv(), { apiKey: "from-env", source: "CLINE_API_KEY" });
});

test("key file lives at <DSH_HOME>/cline.json and is not required to exist", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cline-missing-"));
	assert.equal(keyFilePath(normalizeConfig({}), { DSH_HOME: home }), path.join(home, "cline.json"));
});