export const TOOL_NAMES = {
	READ_FILES: "read_files",
	SEARCH_CODEBASE: "search_codebase",
	RUN_COMMANDS: "run_commands",
	EDITOR: "editor",
	SUBMIT_AND_EXIT: "submit_and_exit",
};

export const ALL_TOOL_NAMES = Object.values(TOOL_NAMES);

export const LEGACY_ALIASES = {
	apply_diff: "editor",
	attempt_completion: "submit_and_exit",
	bash: "run_commands",
	execute_command: "run_commands",
	list_code_definition_names: "search_codebase",
	list_files: "run_commands",
	read_file: "read_files",
	replace_in_file: "editor",
	search_files: "search_codebase",
	write_to_file: "editor",
};

export function canonicalToolName(name) {
	const lowered = String(name ?? "").trim().toLowerCase();
	return LEGACY_ALIASES[lowered] ?? lowered;
}

const READ_SCHEMA = {
	type: "object",
	properties: {
		files: {
			type: "array",
			description: "Array of file read requests; each element is one file and must include path.",
			items: {
				type: "object",
				properties: {
					path: { type: "string", description: "The absolute path of a text file to read content from" },
					start_line: { type: ["integer", "null"], description: "Optional one-based starting line number" },
					end_line: { type: ["integer", "null"], description: "Optional one-based ending line number" },
				},
				required: ["path"],
			},
		},
	},
	required: ["files"],
};

const RUN_SCHEMA = {
	type: "object",
	properties: {
		commands: {
			type: "array",
			minItems: 1,
			description: "Array of complete shell command strings to execute.",
			items: { type: "string" },
		},
	},
	required: ["commands"],
};

const SEARCH_SCHEMA = {
	type: "object",
	properties: {
		queries: {
			type: "array",
			description: "Array of regex search queries to execute",
			items: { type: "string" },
		},
	},
	required: ["queries"],
};

const EDITOR_SCHEMA = {
	type: "object",
	properties: {
		path: { type: "string", description: "The absolute path for the action to be performed on" },
		old_text: { type: "string", description: "Exact text to replace (must match exactly once). Omit this when creating a missing file or inserting via insert_line." },
		new_text: { type: "string", description: "The new content to write when creating a missing file, the replacement text for edits, or the inserted text when insert_line is provided." },
		insert_line: { type: ["integer", "null"], description: "Optional positive one-based boundary line. Inserts new_text before that line; use line_count + 1 to append at EOF." },
	},
	required: ["path", "new_text"],
};

const SUBMIT_SCHEMA = {
	type: "object",
	properties: {
		summary: { type: "string", description: "Summarization of the investigation, steps taken, and resolution status to submit at the end of the session." },
	},
	required: ["summary"],
};

export function toolDescriptions({ readCapLines, readCapChars, searchCapChars, runCapChars, commandCapChars }) {
	return {
		read_files: `Read the content of text or image files at the provided absolute paths, or return only an inclusive one-based line range when start_line/end_line are provided on the same file entry as its path. When you already know multiple files you need, read them together in one call, and call this tool in the same response as other independent tool calls. Each read returns at most ${readCapLines} lines / ~${Math.round(readCapChars / 1024)}k characters; longer files report their total line count, page through them with start_line/end_line on that file's entry. Binary files that are not image and large files are not supported. Returns file contents or error messages for each path.`,
		search_codebase: `Perform regex pattern searches across the codebase. Supports multiple parallel searches. When several search patterns could be useful and do not depend on each other, run them together in one call, and call this tool in the same response as other independent tool calls. Use for finding code patterns, function definitions, class names, imports, etc. Output beyond ~${Math.round(searchCapChars / 1000)}k characters per query is middle-truncated; narrow patterns beat broad ones.`,
		run_commands: `Run non-interactive shell commands from the root of the workspace. Commands should be properly shell-escaped and targeted to avoid error or timeout. Include multiple commands in the same call when they are independent complete shell commands and safe to run concurrently; multiline scripts and heredocs must be a single command string. When independent reads, searches, or edits are also needed, call those tools in the same response. Output beyond ~${Math.round(runCapChars / 1000)}k characters is middle-truncated (start and end preserved); pipe through grep/head/tail when you need specific sections of large output. For long-running commands, run them in background and redirect output to a tmp file that you can read from later. Each command must stay within ${commandCapChars} characters.`,
		editor: `An editor for controlled filesystem edits on the text file at the provided path. Provide \`insert_line\` to insert \`new_text\` at a specific line number. Otherwise, the tool replaces \`old_text\` with \`new_text\`, or creates the file with \`new_text\` if file does not exist. Use this tool for making small, precise edits to existing files or creating new files over shell commands. If several edits to different files or non-overlapping regions are already known, emit multiple editor tool calls in the same response instead of serializing them across turns.`,
		submit_and_exit: `Submit the final answer and exit the conversation. For example, submit a summary of the investigation and confirm the issue is resolved. You should only submit once all necessary steps are completed AND you have verified the result by execution. Before calling this, re-read the task, then confirm from your own tool output that every required file exists at the specified path and that its contents match the expected format, data types, and values. If the task provides tests, run them and confirm they pass; if it does not, run your own solution end to end and read the output back as evidence. Do not submit on the assumption that your solution works — submit because you have observed evidence that it does.`,
	};
}

export function buildToolSpecs(caps = {}) {
	const d = toolDescriptions({
		readCapLines: caps.readCapLines ?? 2000,
		readCapChars: caps.readCapChars ?? 102400,
		searchCapChars: caps.searchCapChars ?? 20000,
		runCapChars: caps.runCapChars ?? 60000,
		commandCapChars: caps.commandCapChars ?? 12000,
	});
	return [
		{ name: TOOL_NAMES.READ_FILES, description: d.read_files, inputSchema: READ_SCHEMA, executionMode: "parallel" },
		{ name: TOOL_NAMES.SEARCH_CODEBASE, description: d.search_codebase, inputSchema: SEARCH_SCHEMA, executionMode: "parallel" },
		{ name: TOOL_NAMES.RUN_COMMANDS, description: d.run_commands, inputSchema: RUN_SCHEMA, executionMode: "parallel" },
		{ name: TOOL_NAMES.EDITOR, description: d.editor, inputSchema: EDITOR_SCHEMA, executionMode: "parallel" },
		{ name: TOOL_NAMES.SUBMIT_AND_EXIT, description: d.submit_and_exit, inputSchema: SUBMIT_SCHEMA, executionMode: "sequential", lifecycle: { completesRun: true } },
	];
}
