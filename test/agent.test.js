import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { mockClient, runtime, tmpdir, reply } from "./helpers.js";

test("runs a tool, then completes via submit_and_exit", async () => {
	const dir = await tmpdir();
	const client = mockClient([
		reply("", [{ toolCallId: "1", toolName: "editor", input: { path: path.join(dir, "a.txt"), new_text: "hello\n" } }]),
		reply("", [{ toolCallId: "2", toolName: "submit_and_exit", input: { summary: "wrote a.txt" } }]),
	]);
	const rt = runtime(client, { cwd: dir });
	const res = await rt.run({ messages: [{ role: "user", content: "make a.txt" }] });

	assert.equal(res.status, "completed");
	assert.equal(res.iterations, 2);
	assert.equal(await fs.readFile(path.join(dir, "a.txt"), "utf8"), "hello\n");
	assert.match(res.outputText, /wrote a\.txt/);
});

test("nudges the model when it stops without calling the completion tool", async () => {
	const dir = await tmpdir();
	const client = mockClient([
		reply("I think we are done."),
		reply("", [{ toolCallId: "2", toolName: "submit_and_exit", input: { summary: "done" } }]),
	]);
	const res = await runtime(client, { cwd: dir }).run({ messages: [{ role: "user", content: "go" }] });

	assert.equal(res.status, "completed");
	const secondCall = client.calls[1].messages;
	const reminder = secondCall.at(-1);
	assert.equal(reminder.role, "user");
	assert.match(reminder.content, /not complete until you call one of these terminal completion tools: submit_and_exit/);
});

test("plan mode blocks a mutating command without running it", async () => {
	const dir = await tmpdir();
	const client = mockClient([
		reply("", [{ toolCallId: "1", toolName: "run_commands", input: { commands: ["touch created.txt"] } }]),
		reply("", [{ toolCallId: "2", toolName: "submit_and_exit", input: { summary: "planned" } }]),
	]);
	const res = await runtime(client, { cwd: dir, mode: "plan" }).run({ messages: [{ role: "user", content: "go" }] });

	const toolMsg = res.messages.find((m) => m.role === "tool");
	assert.match(toolMsg.content, /Command not executed: `touch` can modify files/);
	await assert.rejects(fs.access(path.join(dir, "created.txt")));
});

test("legacy tool aliases are canonicalised", async () => {
	const dir = await tmpdir();
	const client = mockClient([
		reply("", [{ toolCallId: "1", toolName: "write_to_file", input: { path: path.join(dir, "legacy.txt"), new_text: "x" } }]),
		reply("", [{ toolCallId: "2", toolName: "attempt_completion", input: { summary: "ok" } }]),
	]);
	const res = await runtime(client, { cwd: dir }).run({ messages: [{ role: "user", content: "go" }] });
	assert.equal(res.status, "completed");
	assert.equal(await fs.readFile(path.join(dir, "legacy.txt"), "utf8"), "x");
});

test("stops with mistake_limit after repeated tool failures", async () => {
	const dir = await tmpdir();
	const bad = () => reply("", [{ toolCallId: "1", toolName: "read_files", input: { files: [{ path: "/definitely/missing" }] } }]);
	const client = mockClient(Array.from({ length: 20 }, bad));
	const res = await runtime(client, { cwd: dir, maxConsecutiveMistakes: 3 }).run({ messages: [{ role: "user", content: "go" }] });

	assert.equal(res.status, "mistake_limit");
	assert.match(res.outputText, /Stopped after 3\/3 consecutive mistakes/);
});

test("hard loop detection stops an identical call before it runs", async () => {
	const dir = await tmpdir();
	const same = () => reply("", [{ toolCallId: "x", toolName: "run_commands", input: { commands: ["echo hi"] } }]);
	const client = mockClient([same(), same(), same(), same(), same()]);
	const res = await runtime(client, { cwd: dir, maxIterations: 6 }).run({ messages: [{ role: "user", content: "go" }] });

	const blocked = res.messages.filter((m) => m.role === "tool" && /stopping to avoid a loop/.test(m.content));
	assert.ok(blocked.length >= 1);
});

test("maxIterations is enforced", async () => {
	const dir = await tmpdir();
	const client = mockClient([reply("", [{ toolCallId: "1", toolName: "run_commands", input: { commands: ["true"] } }]), reply("", [{ toolCallId: "2", toolName: "run_commands", input: { commands: ["echo 2"] } }])]);
	const res = await runtime(client, { cwd: dir, maxIterations: 2 }).run({ messages: [{ role: "user", content: "go" }] });
	assert.equal(res.status, "error");
	assert.match(res.error, /exceeded maxIterations \(2\)/);
});
