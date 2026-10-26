import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentRuntime } from "../src/agent.js";
import { createTools } from "../src/registry.js";

export function sse(chunks) {
	const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
	return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

export function textChunk(text, finish = null) {
	return { choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] };
}

export function toolChunk(calls) {
	return {
		choices: [{
			index: 0,
			delta: {
				tool_calls: calls.map((c, i) => ({
					index: i,
					id: c.id,
					type: "function",
					function: { name: c.name, arguments: JSON.stringify(c.args) },
				})),
			},
			finish_reason: "tool_calls",
		}],
	};
}

export function mockClient(script) {
	let turn = 0;
	return {
		calls: [],
		async chat(req) {
			this.calls.push(req);
			const step = script[turn++];
			if (!step) throw new Error("mock script exhausted");
			if (step instanceof Error) throw step;
			return typeof step === "function" ? step(req) : step;
		},
	};
}

export async function tmpdir() {
	return fs.mkdtemp(path.join(os.tmpdir(), "cline-re-"));
}

export function runtime(client, opts = {}) {
	return new AgentRuntime({
		client,
		tools: createTools(),
		systemPrompt: "test",
		maxIterations: opts.maxIterations ?? 10,
		maxConsecutiveMistakes: opts.maxConsecutiveMistakes ?? 6,
		cwd: opts.cwd,
		mode: opts.mode ?? "act",
	});
}

export const reply = (text, toolCalls = []) => ({ text, toolCalls, usage: { inputTokens: 1, outputTokens: 1 }, finishReason: toolCalls.length ? "tool_calls" : "stop" });
