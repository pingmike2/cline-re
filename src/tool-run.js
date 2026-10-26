import { spawn } from "node:child_process";
import { detectFileMutation, planModeBlockMessage } from "./plan-guard.js";

export const DEFAULT_TIMEOUT_MS = 30000;
export const MAX_OUTPUT_CHARS = 60 * 1000;

export function getShell(platform = process.platform) {
	if (platform === "win32") return { executable: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] };
	return { executable: "/bin/bash", args: ["-lc"] };
}

function middleTruncate(text, limit) {
	if (text.length <= limit) return text;
	const half = Math.floor(limit / 2);
	return `${text.slice(0, half)}\n\n... [${text.length - limit} characters truncated] ...\n\n${text.slice(-half)}`;
}

function normalizeCommands(input) {
	if (Array.isArray(input)) return input.map((c) => (typeof c === "string" ? c : c?.command)).filter(Boolean);
	if (typeof input === "string") return [input];
	if (Array.isArray(input?.commands)) {
		return input.commands.map((c) => (typeof c === "string" ? c : c?.command)).filter(Boolean);
	}
	if (typeof input?.command === "string") return [input.command];
	return [];
}

export async function runCommandsTool(input, { cwd = process.cwd(), mode = "act", timeoutMs = DEFAULT_TIMEOUT_MS, platform = process.platform } = {}) {
	const commands = normalizeCommands(input);
	if (commands.length === 0) throw new Error("run_commands requires at least one command");
	if (commands.length > 8) throw new Error("Too many commands in one call (max 8).");

	if (mode === "plan") {
		for (const cmd of commands) {
			const reason = detectFileMutation(cmd);
			if (reason) return { blocked: true, reason, message: planModeBlockMessage(reason) };
		}
	}

	const results = [];
	for (const cmd of commands) {
		results.push(await runOne(cmd, { cwd, timeoutMs, platform }));
	}
	return { results };
}

function runOne(command, { cwd, timeoutMs, platform }) {
	const shell = getShell(platform);
	return new Promise((resolve) => {
		const started = Date.now();
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const child = spawn(shell.executable, [...shell.args, command], { cwd, env: process.env });
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);

		child.stdout.on("data", (d) => { stdout += d.toString(); });
		child.stderr.on("data", (d) => { stderr += d.toString(); });
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ command, error: err.message, exit_code: null, duration_ms: Date.now() - started });
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			resolve({
				command,
				exit_code: code,
				...(signal ? { signal } : {}),
				...(timedOut ? { timed_out: true, timeout_ms: timeoutMs } : {}),
				stdout: middleTruncate(stdout, MAX_OUTPUT_CHARS),
				stderr: middleTruncate(stderr, MAX_OUTPUT_CHARS),
				duration_ms: Date.now() - started,
			});
		});
	});
}
