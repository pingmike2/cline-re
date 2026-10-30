import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startMock } from "./mock.js";
import { createClineTool } from "../lib/tool.js";
import { createKeyResolver, normalizeConfig } from "../lib/settings.js";

const FRAMES = [
	{ choices: [{ index: 0, delta: { content: "working" }, finish_reason: null }] },
	{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c2", type: "function", function: { name: "submit_and_exit", arguments: "{\"summary\":\"ok\"}" } }] }, finish_reason: null }] },
	{ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
];

async function workspace() {
	return fs.mkdtemp(path.join(os.tmpdir(), "dsh-cline-"));
}

test("delegates a task to the Cline agent and returns its summary", async () => {
	const cwd = await workspace();
	const mock = await startMock({ frames: FRAMES });
	try {
		const config = normalizeConfig({ apiKey: "k", baseURL: mock.url, model: "solar-mini4", defaultCwd: cwd });
		const tool = createClineTool({ config, resolveKey: async () => ({ apiKey: "k" }), env: {} });
		assert.equal(tool.name, "cline");
		assert.deepEqual(tool.parameters.required, ["prompt"]);
		const value = await tool.execute({ prompt: "say hi" }, {});
		assert.equal(value.status, "completed");
		assert.equal(value.output, "ok");
		assert.ok(value.iterations >= 1);
		const request = mock.requests[0];
		assert.equal(request.headers.authorization, "Bearer k");
		assert.match(request.body.messages[0].content, /working directory/i);
		assert.equal(request.body.messages.at(-1).content, "say hi");
	} finally {
		await mock.close();
	}
});

test("refuses to run without a Cline API key and points at the key file", async () => {
	const cwd = await workspace();
	const config = normalizeConfig({ baseURL: "http://127.0.0.1:1/v1", defaultCwd: cwd });
	const tool = createClineTool({ config, resolveKey: async () => ({ apiKey: "" }), env: { DSH_HOME: cwd } });
	await assert.rejects(
		() => tool.execute({ prompt: "hi" }, {}),
		(err) => err.code === "MISSING_CREDENTIAL" && err.message.includes(path.join(cwd, "cline.json")),
	);
});

test("reads the API key from <DSH_HOME>/cline.json, so users can fill it in themselves", async () => {
	const cwd = await workspace();
	await fs.writeFile(path.join(cwd, "cline.json"), JSON.stringify({ apiKey: "file-key" }));
	const mock = await startMock({ frames: FRAMES });
	try {
		const config = normalizeConfig({ baseURL: mock.url, defaultCwd: cwd });
		const tool = createClineTool({ config, resolveKey: createKeyResolver({ config, env: { DSH_HOME: cwd } }), env: { DSH_HOME: cwd } });
		const value = await tool.execute({ prompt: "hi" }, {});
		assert.equal(value.status, "completed");
		assert.equal(mock.requests[0].headers.authorization, "Bearer file-key");
	} finally {
		await mock.close();
	}
});