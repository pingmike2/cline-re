import { spawn } from "node:child_process";

const SKIP_DIRS = ["node_modules", ".git", "dist", "build", ".next", "target", "vendor", "__pycache__"];
export const MAX_RESULT_CHARS = 20 * 1000;

export async function searchCodebaseTool({ queries }, { cwd = process.cwd(), timeoutMs = 30000 } = {}) {
	const list = Array.isArray(queries) ? queries : [queries];
	if (!list.length) throw new Error("search_codebase requires at least one regex query");
	const results = await Promise.all(list.map((q) => runRipgrep(String(q), cwd, timeoutMs)));
	return { results };
}

function runRipgrep(pattern, cwd, timeoutMs) {
	return new Promise((resolve) => {
		const args = ["--line-number", "--no-heading", "--color", "never", "--max-count", "50"];
		for (const d of SKIP_DIRS) args.push("--glob", `!${d}/**`);
		args.push("--", pattern, ".");
		const child = spawn("rg", args, { cwd });
		let out = "";
		let err = "";
		const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
		child.stdout.on("data", (d) => { out += d.toString(); });
		child.stderr.on("data", (d) => { err += d.toString(); });
		child.on("error", (e) => {
			clearTimeout(timer);
			resolve({ query: pattern, error: `ripgrep unavailable: ${e.message}` });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
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
