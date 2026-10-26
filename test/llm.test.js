import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIClient, ProviderError, ContextWindowError, isContextWindowError } from "../src/llm.js";
import { sse, textChunk, toolChunk } from "./helpers.js";

function client(fetchImpl, opts = {}) {
	return new OpenAIClient({ baseURL: "http://mock/v1", apiKey: "k", model: "m", fetchImpl, ...opts });
}

test("parses streamed text and usage", async () => {
	const c = client(async () => sse([
		textChunk("Hel"),
		textChunk("lo"),
		{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } },
	]));
	const out = await c.chat({ messages: [{ role: "user", content: "hi" }] });
	assert.equal(out.text, "Hello");
	assert.equal(out.finishReason, "stop");
	assert.deepEqual(out.usage, { inputTokens: 7, outputTokens: 3 });
	assert.equal(out.toolCalls.length, 0);
});

test("parses streamed tool calls with fragmented arguments", async () => {
	const c = client(async () => sse([
		{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read_files", arguments: '{"files":[' } }] } }] },
		{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"/a"}]}' } }] } }] },
		{ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
	]));
	const out = await c.chat({ messages: [] });
	assert.equal(out.finishReason, "tool_calls");
	assert.equal(out.toolCalls.length, 1);
	assert.equal(out.toolCalls[0].toolName, "read_files");
	assert.deepEqual(out.toolCalls[0].input, { files: [{ path: "/a" }] });
});

test("sends an OpenAI-compatible tool schema", async () => {
	let seen;
	const c = client(async (_url, init) => { seen = JSON.parse(init.body); return sse([textChunk("ok", "stop")]); });
	await c.chat({ messages: [{ role: "user", content: "x" }], tools: [{ name: "editor", description: "d", inputSchema: { type: "object", properties: {} } }] });
	assert.equal(seen.model, "m");
	assert.equal(seen.stream, true);
	assert.equal(seen.tools[0].type, "function");
	assert.equal(seen.tools[0].function.name, "editor");
	assert.equal(seen.tool_choice, "auto");
});

test("retries on 5xx then succeeds", async () => {
	let n = 0;
	const c = client(async () => {
		n += 1;
		if (n === 1) return new Response("boom", { status: 502 });
		return sse([textChunk("ok", "stop")]);
	});
	const out = await c.chat({ messages: [] });
	assert.equal(out.text, "ok");
	assert.equal(n, 2);
});

test("does not retry on 400", async () => {
	let n = 0;
	const c = client(async () => { n += 1; return new Response("bad", { status: 400 }); });
	await assert.rejects(c.chat({ messages: [] }), ProviderError);
	assert.equal(n, 1);
});

test("surfaces context-window errors distinctly", async () => {
	const c = client(async () => new Response(JSON.stringify({ error: "context_length_exceeded" }), { status: 400 }));
	await assert.rejects(c.chat({ messages: [] }), ContextWindowError);
	assert.equal(isContextWindowError({ status: 413 }), true);
	assert.equal(isContextWindowError({ message: "prompt is too long" }), true);
	assert.equal(isContextWindowError({ message: "nope" }), false);
});
