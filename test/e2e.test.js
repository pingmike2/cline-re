import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createAgent } from "../src/index.js";
import { startMockCline } from "./mock-server.js";
import { tmpdir } from "./helpers.js";

test("end-to-end over real HTTP: read_files -> submit_and_exit", async () => {
	const dir = await tmpdir();
	await fs.writeFile(path.join(dir, "smoke.txt"), "hello-from-smoke-42\n");
	const mock = await startMockCline();

	try {
		const agent = await createAgent({
			apiKey: "test-key",
			baseURL: mock.url,
			model: "test-model",
			cwd: dir,
			maxIterations: 6,
		});
		const res = await agent.run({ messages: [{ role: "user", content: "read smoke.txt" }] });

		assert.equal(res.status, "completed");
		assert.equal(res.iterations, 2);
		assert.match(res.outputText, /read smoke\.txt successfully/);

		const transcript = res.messages.map((m) => m.content ?? "").join("\n");
		assert.match(transcript, /hello-from-smoke-42/);

		const toolResults = res.messages.filter((m) => m.role === "tool").map((m) => m.content);
		assert.equal(toolResults.length, 2);
		assert.match(toolResults[0], /hello-from-smoke-42/);
		assert.match(toolResults[1], /read smoke\.txt successfully/);
	} finally {
		await mock.close();
	}
});
