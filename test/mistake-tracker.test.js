import test from "node:test";
import assert from "node:assert/strict";
import { MistakeTracker } from "../src/guardrails.js";

const quiet = () => {};

function make(max, onLimitReached) {
	return new MistakeTracker({ maxConsecutiveMistakes: max, onLimitReached, emit: quiet, log: quiet });
}

test("returns continue below the limit", async () => {
	const t = make(3);
	assert.equal((await t.record({ iteration: 1, reason: "tool_execution_failed" })).action, "continue");
	assert.equal((await t.record({ iteration: 2, reason: "tool_execution_failed" })).action, "continue");
	assert.equal(t.value, 2);
});

test("stops at the limit with a formatted message", async () => {
	const t = make(2);
	await t.record({ iteration: 1, reason: "tool_execution_failed" });
	const rec = await t.record({ iteration: 2, reason: "tool_execution_failed", details: "2 tool call(s) failed" });
	assert.equal(rec.action, "stop");
	assert.match(rec.message, /Stopped after 2\/2 consecutive mistakes/);
	assert.match(rec.message, /at iteration 2/);
	assert.match(rec.message, /Error: 2 tool call\(s\) failed/);
	assert.match(rec.message, /Session state was preserved/);
});

test("reset clears the counter after success", async () => {
	const t = make(3);
	await t.record({ iteration: 1, reason: "x" });
	t.reset();
	assert.equal(t.value, 0);
});

test("a handler returning continue resets the streak and can pass guidance", async () => {
	const t = make(1, async () => ({ action: "continue", guidance: "try a different approach" }));
	const rec = await t.record({ iteration: 1, reason: "x" });
	assert.equal(rec.action, "continue");
	assert.equal(rec.guidance, "try a different approach");
	assert.equal(t.value, 0);
});

test("a throwing handler degrades to stop", async () => {
	const t = make(1, async () => { throw new Error("handler exploded"); });
	const rec = await t.record({ iteration: 1, reason: "x" });
	assert.equal(rec.action, "stop");
	assert.match(rec.message, /Decision: handler exploded/);
});

test("max = 0/undefined means never stop", async () => {
	const t = make(undefined);
	for (let i = 0; i < 10; i += 1) {
		assert.equal((await t.record({ iteration: i, reason: "x" })).action, "continue");
	}
});
