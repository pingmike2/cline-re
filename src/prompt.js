import os from "node:os";
import { ACT_SYSTEM_PROMPT } from "./prompt-act.js";
import { YOLO_SYSTEM_PROMPT } from "./prompt-yolo.js";

export function renderTemplate(template, vars) {
	return template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) => {
		if (!(key in vars)) return whole;
		const value = vars[key];
		return value == null ? "" : String(value);
	});
}

export function platformName(platform = process.platform) {
	if (platform === "darwin") return "darwin";
	if (platform === "win32") return "win32";
	return platform;
}

export function buildPromptVars({ cwd, platform = process.platform, ide = "cli", date = new Date(), rules = "", metadata = "" } = {}) {
	return {
		PLATFORM_NAME: platformName(platform),
		SHELL_NAME: platform === "win32" ? "powershell.exe" : "/bin/bash",
		CURRENT_DATE: date.toISOString().slice(0, 10),
		IDE_NAME: ide,
		CWD: cwd ?? process.cwd(),
		CLINE_RULES: rules ? `\n<rules>\n${rules}\n</rules>` : "",
		CLINE_METADATA: metadata ? `\n<metadata>\n${metadata}\n</metadata>` : "",
	};
}

export function buildSystemPrompt({ mode = "act", ...rest } = {}) {
	const template = mode === "yolo" ? YOLO_SYSTEM_PROMPT : ACT_SYSTEM_PROMPT;
	return renderTemplate(template, buildPromptVars(rest));
}

export const COMPLETION_REMINDER = (names) =>
	`[SYSTEM] This run is not complete until you call one of these terminal completion tools: ${names.join(", ")}. Continue working if requirements are not met. If the task is complete, call the appropriate terminal completion tool now.`;

export function countMessagePairs(messages) {
	let pairs = 0;
	let open = false;
	for (const m of messages) {
		if (m.role === "user") open = true;
		else if (m.role === "assistant" && open) {
			pairs += 1;
			open = false;
		}
	}
	return pairs;
}

export const ENV_INFO = () => ({ platform: platformName(), cwd: process.cwd(), homedir: os.homedir() });
