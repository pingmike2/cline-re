import path from "node:path";
import { buildToolSpecs, TOOL_NAMES } from "./tools.js";
import { readFileTool } from "./tool-read.js";
import { editorTool } from "./tool-editor.js";
import { runCommandsTool } from "./tool-run.js";
import { searchCodebaseTool } from "./tool-search.js";

function resolvePath(p, cwd) {
	if (!p || typeof p !== "string") return p;
	return path.isAbsolute(p) ? p : path.resolve(cwd ?? process.cwd(), p);
}

function withAbsolutePaths(input, cwd) {
	if (!input) return input;
	if (Array.isArray(input.files)) {
		return { ...input, files: input.files.map((f) => ({ ...f, path: resolvePath(f.path, cwd) })) };
	}
	if (typeof input.path === "string") return { ...input, path: resolvePath(input.path, cwd) };
	return input;
}

export function createTools({ caps } = {}) {
	const specs = buildToolSpecs(caps);
	const executors = {
		[TOOL_NAMES.READ_FILES]: (input, ctx) => readFileTool(withAbsolutePaths(input, ctx?.cwd)),
		[TOOL_NAMES.EDITOR]: (input, ctx) => editorTool(withAbsolutePaths(input, ctx?.cwd)),
		[TOOL_NAMES.RUN_COMMANDS]: (input, ctx) => runCommandsTool(input, ctx),
		[TOOL_NAMES.SEARCH_CODEBASE]: (input, ctx) => searchCodebaseTool(input, ctx),
		[TOOL_NAMES.SUBMIT_AND_EXIT]: (input) => ({ ok: true, summary: input?.summary ?? "" }),
	};
	return specs.map((s) => ({ ...s, execute: executors[s.name] }));
}
