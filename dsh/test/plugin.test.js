import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { apply, inject, name } from "../lib/index.js";

function fakeContext() {
	const calls = { adapters: [], directories: [], tools: [] };
	const ctx = {
		fiber: { entry: { options: { id: "dsh-cline" } } },
		llm: {
			registerAdapter(providers, adapter) {
				calls.adapters.push({ providers, adapter });
				return () => {};
			},
			registerConfigurableProviders(entries) {
				calls.directories.push(...entries);
				return () => {};
			},
		},
		tools: {
			register(tool) {
				calls.tools.push(tool);
				return () => {};
			},
		},
		effect(run) {
			run();
		},
	};
	return { ctx, calls };
}

test("the plugin exports the identity a bundle row needs", () => {
	assert.equal(name, "dsh-cline");
	assert.deepEqual(inject, ["tools", "llm"]);
	const manifest = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(manifest.main, "lib/index.js");
	assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");
	assert.ok(fs.existsSync(new URL("../cordis.patch.yml", import.meta.url)));
});

test("apply registers the Cline provider and the cline tool", () => {
	const { ctx, calls } = fakeContext();
	apply(ctx, { apiKey: "configured" });
	assert.deepEqual(calls.adapters.map((entry) => entry.providers), [["cline"]]);
	assert.deepEqual(calls.adapters[0].adapter.providerInfo(), { id: "cline", name: "Cline" });
	assert.deepEqual(calls.directories, [{ provider: "cline", displayName: "Cline", settingsNs: "dsh-cline", settingsPath: [] }]);
	assert.deepEqual(calls.tools.map((tool) => tool.name), ["cline"]);
});

test("feature flags turn each half off", () => {
	const { ctx, calls } = fakeContext();
	apply(ctx, { enableProvider: false, enableTool: false });
	assert.equal(calls.adapters.length, 0);
	assert.equal(calls.directories.length, 0);
	assert.equal(calls.tools.length, 0);
});

test("a row without an entry id still lands on the dsh-cline namespace", () => {
	const { ctx, calls } = fakeContext();
	ctx.fiber = undefined;
	apply(ctx, {});
	assert.equal(calls.directories[0].settingsNs, "dsh-cline");
	assert.equal(path.basename(new URL("../cordis.patch.yml", import.meta.url).pathname), "cordis.patch.yml");
});