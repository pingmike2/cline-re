import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { searchCodebaseTool } from "../src/tool-search.js";
import { tmpdir } from "./helpers.js";

async function fixture() {
	const dir = await tmpdir();
	await fs.mkdir(path.join(dir, "src"), { recursive: true });
	await fs.mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
	await fs.writeFile(path.join(dir, "src", "math.js"), "export function add(a, b) {\n  return a + b;\n}\n");
	await fs.writeFile(path.join(dir, "src", "other.js"), "const sum = (a, b) => a + b;\n");
	await fs.writeFile(path.join(dir, "node_modules", "pkg", "index.js"), "function add() {}\n");
	return dir;
}

test("search finds matches with file and line numbers", async () => {
	const dir = await fixture();
	const { results } = await searchCodebaseTool({ queries: ["function add"] }, { cwd: dir });
	assert.equal(results.length, 1);
	const [res] = results;
	assert.equal(res.error, undefined);
	assert.equal(res.match_count, 1);
	assert.match(res.output, /^src\/math\.js:1:/m);
});

test("search skips ignored directories", async () => {
	const dir = await fixture();
	const { results } = await searchCodebaseTool({ queries: ["add"] }, { cwd: dir });
	const output = results[0].output;
	assert.match(output, /src\/math\.js:1:/);
	assert.doesNotMatch(output, /node_modules/);
});

test("search runs multiple queries and reports no matches", async () => {
	const dir = await fixture();
	const { results } = await searchCodebaseTool({ queries: ["add", "doesNotExistAnywhere"] }, { cwd: dir });
	assert.equal(results.length, 2);
	assert.match(results[0].output, /math\.js/);
	assert.equal(results[1].match_count, 0);
	assert.equal(results[1].output, "(no matches)");
});
