import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitCheckpointer } from "../src/checkpoint.js";
import { tmpdir } from "./helpers.js";

const run = promisify(execFile);
const git = (cwd, ...a) => run("git", a, { cwd });

async function repo() {
	const dir = await tmpdir();
	await git(dir, "init", "-q");
	await git(dir, "config", "user.email", "t@t.t");
	await git(dir, "config", "user.name", "t");
	await fs.writeFile(path.join(dir, ".gitattributes"), "* text=auto eol=lf\n");
	await fs.writeFile(path.join(dir, "a.txt"), "v1\n");
	await git(dir, "add", ".");
	await git(dir, "commit", "-qm", "init");
	return dir;
}

test("checkpoint captures and restores working-tree state", async () => {
	const dir = await repo();
	const cp = new GitCheckpointer({ cwd: dir, sessionId: "s1" });
	assert.equal(await cp.init(), true);

	const snap = await cp.snapshot();
	assert.ok(snap?.ref, "expected a commit ref");

	await fs.writeFile(path.join(dir, "a.txt"), "v2-modified\n");
	await fs.writeFile(path.join(dir, "b.txt"), "new file\n");

	assert.equal(await cp.restore(snap.runCount), true);
	assert.equal(await fs.readFile(path.join(dir, "a.txt"), "utf8"), "v1\n");
	await assert.rejects(fs.access(path.join(dir, "b.txt")));
});

test("clear removes refs and non-git dirs are inert", async () => {
	const dir = await repo();
	const cp = new GitCheckpointer({ cwd: dir, sessionId: "s2" });
	await cp.init();
	await cp.snapshot();
	await cp.clear();
	const { stdout } = await git(dir, "for-each-ref", "--format=%(refname)", "refs/cline/");
	assert.equal(stdout.trim(), "");

	const plain = await tmpdir();
	const inert = new GitCheckpointer({ cwd: plain, sessionId: "s3" });
	assert.equal(await inert.init(), false);
	assert.equal(await inert.snapshot(), undefined);
	assert.equal(await inert.restore(1), false);
});
