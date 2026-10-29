import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const SKIP_DIRS = ["node_modules", ".git", "dist", "build", ".next", "target", "vendor", "__pycache__"];
export const MAX_RESULT_CHARS = 20 * 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MATCHES_PER_FILE = 50;
const MAX_MATCHES = 200;

export async function searchCodebaseTool({ queries }, { cwd = process.cwd(), timeoutMs = 30000 } = {}) {
	const list = Array.isArray(queries) ? queries : [queries];
	if (!list.length) throw new Error("search_codebase requires at least one regex query");
	const results = await Promise.all(list.map((q) => runRipgrep(String(q), cwd, timeoutMs)));
	return { results };
}

function runRipgrep(pattern, cwd, timeoutMs) {
	return new Promise((resolve) => {
		const args = ["--line-number", "--no-heading", "--color", "never", "--max-count", String(MAX_MATCHES_PER_FILE)];
		for (const d of SKIP_DIRS) args.push("--glob", `!${d}/**`);
		args.push("--", pattern, ".");
		const child = spawn("rg", args, { cwd, env: { ...process.env, LC_ALL: "C" } });
		let out = "";
		let err = "";
		let spawnError;
		const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
		child.stdout.on("data", (d) => { out += d.toString(); });
		child.stderr.on("data", (d) => { err += d.toString(); });
		child.on("error", (e) => {
			clearTimeout(timer);
			spawnError = e;
		});
		child.on("close", async (code) => {
			clearTimeout(timer);
			if (spawnError) {
				if (spawnError.code === "ENOENT") resolve(await searchWithoutRipgrep(pattern, cwd));
				else resolve({ query: pattern, error: `ripgrep unavailable: ${spawnError.message}` });
				return;
			}
			const lines = out.split("\n").filter(Boolean);
			const truncated = out.length > MAX_RESULT_CHARS;
			resolve({
				query: pattern,
				match_count: lines.length,
				exit_code: code,
				...(truncated ? { truncated: true } : {}),
				output: (truncated ? out.slice(0, MAX_RESULT_CHARS) : out).trim() || "(no matches)",
				...(err.trim() ? { stderr: err.trim() } : {}),
			});
		});
	});
}

async function searchWithoutRipgrep(pattern, cwd) {
	let re;
	try {
		re = new RegExp(pattern);
	} catch (err) {
		return { query: pattern, error: `invalid regex: ${err.message}` };
	}
	const hits = [];
	const pending = [{ dir: cwd, rel: "" }];
	while (pending.length && hits.length < MAX_MATCHES) {
		const { dir, rel } = pending.pop();
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (hits.length >= MAX_MATCHES) break;
			const relPath = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.includes(entry.name)) pending.push({ dir: path.join(dir, entry.name), rel: relPath });
				continue;
			}
			if (!entry.isFile()) continue;
			await scanFile(path.join(dir, entry.name), `./${relPath}`, re, hits);
		}
	}
	const output = hits.join("\n");
	const truncated = output.length > MAX_RESULT_CHARS;
	return {
		query: pattern,
		match_count: hits.length,
		exit_code: hits.length ? 0 : 1,
		engine: "js",
		...(truncated ? { truncated: true } : {}),
		output: (truncated ? output.slice(0, MAX_RESULT_CHARS) : output) || "(no matches)",
		...(hits.length >= MAX_MATCHES ? { capped: true } : {}),
	};
}

async function scanFile(abs, relPath, re, hits) {
	let size;
	try {
		size = (await fs.stat(abs)).size;
	} catch {
		return;
	}
	if (size > MAX_FILE_BYTES) return;
	let text;
	try {
		text = await fs.readFile(abs, "utf8");
	} catch {
		return;
	}
	if (text.includes("\u0000")) return;
	const lines = text.split(/\r?\n/);
	let perFile = 0;
	for (let i = 0; i < lines.length; i += 1) {
		if (perFile >= MAX_MATCHES_PER_FILE || hits.length >= MAX_MATCHES) return;
		re.lastIndex = 0;
		if (re.test(lines[i])) {
			hits.push(`${relPath}:${i + 1}:${lines[i]}`);
			perFile += 1;
		}
	}
}
