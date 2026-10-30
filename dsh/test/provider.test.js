import test from "node:test";
import assert from "node:assert/strict";
import { startMock } from "./mock.js";
import { createClineAdapter, describeFailure } from "../lib/provider.js";
import { toClientTools, toWireMessages } from "../lib/wire.js";

const FRAMES = [
	{ choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
	{ choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] },
	{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read_files", arguments: "{\"files\":[{\"path\":\"a.txt\"}]}" } }] }, finish_reason: null }] },
	{ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
];

function adapterFor(mock, overrides = {}) {
	return createClineAdapter({
		baseURL: mock.url,
		resolveKey: async () => ({ apiKey: "test-key" }),
		missingKeyError: () => Object.assign(new Error("missing"), { code: "MISSING_CREDENTIAL" }),
		headersFor: () => ({ "X-Test": "1" }),
		...overrides,
	});
}

async function collect(stream) {
	const chunks = [];
	for await (const chunk of stream) chunks.push(chunk);
	return chunks;
}

test("translates DSH messages and tools to the OpenAI wire", () => {
	const wire = toWireMessages([
		{ role: "user", content: [{ type: "text", text: "hi" }] },
		{ role: "assistant", content: [{ type: "text", text: "checking" }, { type: "tool-call", id: "c1", name: "read_files", arguments: "{\"files\":[]}" }] },
		{ role: "tool", toolCallId: "c1", content: [{ type: "text", text: "ok" }] },
	], "SYS");
	assert.equal(wire[0].content, "SYS");
	assert.equal(wire[1].content, "hi");
	assert.equal(wire[2].tool_calls[0].function.name, "read_files");
	assert.equal(wire[2].tool_calls[0].function.arguments, "{\"files\":[]}");
	assert.deepEqual(wire[3], { role: "tool", tool_call_id: "c1", content: "ok" });
	assert.equal(toClientTools([{ name: "read_files", description: "read", parameters: { type: "object", properties: {} } }])[0].inputSchema.type, "object");
});

test("streams text as blocks and tool calls as tool-call blocks", async () => {
	const mock = await startMock({ frames: FRAMES });
	try {
		const adapter = adapterFor(mock);
		assert.deepEqual(adapter.providerInfo(), { id: "cline", name: "Cline" });
		const prepared = await adapter.prepareCall("cline", "solar-mini4");
		assert.equal(prepared.model.id, "cline-free/solar-mini4");
		assert.equal(prepared.model.input[0], "text");
		const chunks = await collect(prepared.stream({
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
			system: "SYS",
			tools: [{ name: "read_files", description: "read", parameters: { type: "object", properties: {} } }],
			maxTokens: 123,
			sessionId: "sess-1",
		}));

		assert.deepEqual(chunks.map((chunk) => chunk.type), [
			"block-start", "text-delta", "block-end",
			"block-start", "tool-call-delta", "block-end",
			"usage", "finish",
		]);
		assert.deepEqual(chunks[1], { type: "text-delta", index: 0, text: "Hello" });
		assert.deepEqual(chunks[5].block, { type: "tool-call", id: "call_1", name: "read_files", arguments: "{\"files\":[{\"path\":\"a.txt\"}]}" });
		assert.deepEqual(chunks[6].usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
		assert.deepEqual(chunks[7].reason, { kind: "tool-calls" });

		const request = mock.requests[0];
		assert.equal(request.url, "/v1/chat/completions");
		assert.equal(request.headers.authorization, "Bearer test-key");
		assert.equal(request.headers["x-test"], "1");
		assert.equal(request.body.model, "cline-free/solar-mini4");
		assert.equal(request.body.max_tokens, 123);
		assert.equal(request.body.stream, true);
		assert.equal(request.body.messages[0].content, "SYS");
		assert.equal(request.body.tools[0].function.name, "read_files");
	} finally {
		await mock.close();
	}
});

test("a 401 ends the stream with an AUTH failure", async () => {
	const mock = await startMock({ status: 401, body: { error: { message: "bad key" } } });
	try {
		const adapter = adapterFor(mock);
		const prepared = await adapter.prepareCall("cline", "beam");
		const chunks = await collect(prepared.stream({ messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }));
		assert.equal(chunks.length, 1);
		assert.equal(chunks[0].reason.kind, "error");
		assert.equal(chunks[0].reason.failure.code, "AUTH");
	} finally {
		await mock.close();
	}
});

test("prepareCall refuses to start without a key", async () => {
	const adapter = adapterFor({ url: "http://127.0.0.1:1/v1" }, { resolveKey: async () => ({ apiKey: "" }) });
	await assert.rejects(() => adapter.prepareCall("cline", "solar-mini4"), (err) => err.code === "MISSING_CREDENTIAL");
});

test("maps provider failures onto DSH failure codes", () => {
	assert.equal(describeFailure({ status: 429, message: "slow down" }).code, "RATE_LIMIT");
	assert.equal(describeFailure({ status: 402, message: "pay" }).code, "QUOTA");
	assert.equal(describeFailure({ message: "maximum context length exceeded" }).code, "INVALID_REQUEST");
	assert.equal(describeFailure({ name: "AbortError" }).aborted, true);
});