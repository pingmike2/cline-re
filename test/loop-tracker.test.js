import test from "node:test";
import assert from "node:assert/strict";
import { LoopTracker } from "../src/guardrails.js";

test("soft warning fires on the 3rd identical call", () => {
	const t = new LoopTracker();
	assert.equal(t.inspect({ name: "read_files", input: { a: 1 } }).kind, "ok");
	assert.equal(t.inspect({ name: "read_files", input: { a: 1 } }).kind, "ok");
	const third = t.inspect({ name: "read_files", input: { a: 1 } });
	assert.equal(third.kind, "soft");
	assert.match(third.message, /3 consecutive identical calls to `read_files`/);
});

test("hard stop fires on the 5th identical call", () => {
	const t = new LoopTracker();
	for (let i = 0; i < 4; i += 1) t.inspect({ name: "run_commands", input: { commands: ["ls"] } });
	const fifth = t.inspect({ name: "run_commands", input: { commands: ["ls"] } });
	assert.equal(fifth.kind, "hard");
	assert.match(fifth.message, /stopping to avoid a loop/);
});

test("different input resets the counter", () => {
	const t = new LoopTracker();
	t.inspect({ name: "read_files", input: { a: 1 } });
	t.inspect({ name: "read_files", input: { a: 1 } });
	const other = t.inspect({ name: "read_files", input: { a: 2 } });
	assert.equal(other.kind, "ok");
	assert.equal(t.count, 1);
});

test("key order does not affect signature", () => {
	const t = new LoopTracker();
	t.inspect({ name: "editor", input: { path: "/a", new_text: "x" } });
	t.inspect({ name: "editor", input: { new_text: "x", path: "/a" } });
	const third = t.inspect({ name: "editor", input: { path: "/a", new_text: "x" } });
	assert.equal(third.kind, "soft");
});
