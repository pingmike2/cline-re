import fs from "node:fs/promises";
import path from "node:path";
import { assertAbsolute } from "./tool-read.js";

export const MAX_EDIT_CHARS = 6000;

export async function editorTool({ path: filePath, old_text: oldText, new_text: newText, insert_line: insertLine }) {
	const abs = assertAbsolute(filePath);
	if (typeof newText !== "string") throw new Error("new_text is required and must be a string");

	let exists = false;
	try {
		await fs.access(abs);
		exists = true;
	} catch {
		exists = false;
	}

	if (!exists && oldText !== undefined && oldText !== null) {
		throw new Error(`File does not exist: ${abs}. Omit old_text to create it.`);
	}

	if (!exists) {
		await fs.mkdir(path.dirname(abs), { recursive: true });
		await fs.writeFile(abs, newText, "utf8");
		return { path: abs, action: "created", bytes: Buffer.byteLength(newText) };
	}

	const before = await fs.readFile(abs, "utf8");

	if (insertLine != null) {
		const lineNo = Number(insertLine);
		if (!Number.isInteger(lineNo) || lineNo < 1) throw new Error("insert_line must be a positive integer");
		const lines = before.split("\n");
		const at = Math.min(lineNo - 1, lines.length);
		const inserted = newText.split("\n");
		const after = [...lines.slice(0, at), ...inserted, ...lines.slice(at)].join("\n");
		await fs.writeFile(abs, after, "utf8");
		return { path: abs, action: "inserted", at_line: lineNo, lines_added: inserted.length };
	}

	if (typeof oldText !== "string" || oldText.length === 0) {
		throw new Error("old_text is required for replacement edits (or use insert_line to insert).");
	}

	const first = before.indexOf(oldText);
	if (first === -1) {
		throw new Error(`old_text not found in ${abs}. Read the file and copy the exact text.`);
	}
	if (before.indexOf(oldText, first + oldText.length) !== -1) {
		throw new Error(`old_text matches more than once in ${abs}; include more surrounding context to make it unique.`);
	}

	const after = before.slice(0, first) + newText + before.slice(first + oldText.length);
	await fs.writeFile(abs, after, "utf8");
	return { path: abs, action: "replaced", old_chars: oldText.length, new_chars: newText.length };
}
