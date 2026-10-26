import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { saveSession, loadSession, listSessions, newSessionId, dataDir } from "../src/session.js";
import { tmpdir } from "./helpers.js";

test("sessions round-trip and list newest first", async () => {
	const dir = await tmpdir();
	process.env.CLINE_DATA_DIR = dir;
	try {
		assert.equal(dataDir(), dir);
		const id = newSessionId();
		await saveSession({ id, title: "first", messages: [{ role: "user", content: "hi" }] });
		const loaded = await loadSession(id);
		assert.equal(loaded.title, "first");
		assert.equal(loaded.messages.length, 1);
		assert.ok(loaded.updatedAt);

		const list = await listSessions();
		assert.equal(list.length, 1);
		assert.equal(list[0].id, id);
		assert.equal(list[0].messages, 1);
	} finally {
		delete process.env.CLINE_DATA_DIR;
	}
});

test("atomic write leaves no tmp files behind", async () => {
	const dir = await tmpdir();
	process.env.CLINE_DATA_DIR = dir;
	try {
		const id = newSessionId();
		await saveSession({ id, title: "x", messages: [] });
		const names = await fs.readdir(path.join(dir, "sessions"));
		assert.deepEqual(names, [`${id}.json`]);
	} finally {
		delete process.env.CLINE_DATA_DIR;
	}
});
