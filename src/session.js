import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export function dataDir() {
	const override = process.env.CLINE_DATA_DIR;
	if (override) return override;
	return path.join(os.homedir(), ".cline-re");
}

export function sessionsDir() {
	return path.join(dataDir(), "sessions");
}

export function newSessionId() {
	return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

export async function saveSession(session) {
	const dir = sessionsDir();
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(dir, `${session.id}.json`);
	const payload = { ...session, updatedAt: new Date().toISOString() };
	await fs.writeFile(`${file}.tmp`, JSON.stringify(payload, null, 2));
	await fs.rename(`${file}.tmp`, file);
	return file;
}

export async function loadSession(id) {
	const text = await fs.readFile(path.join(sessionsDir(), `${id}.json`), "utf8");
	return JSON.parse(text);
}

export async function listSessions() {
	try {
		const names = await fs.readdir(sessionsDir());
		const out = [];
		for (const name of names.filter((n) => n.endsWith(".json"))) {
			try {
				const s = JSON.parse(await fs.readFile(path.join(sessionsDir(), name), "utf8"));
				out.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, messages: s.messages?.length ?? 0 });
			} catch {
				continue;
			}
		}
		return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
	} catch {
		return [];
	}
}
