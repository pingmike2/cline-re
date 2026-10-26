import fs from "node:fs/promises";
import path from "node:path";

export const MAX_READ_LINES = 2000;
export const MAX_READ_CHARS = 100 * 1024;

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

export function assertAbsolute(p) {
	if (!path.isAbsolute(String(p ?? ""))) {
		throw new Error(`Path must be absolute: ${p}`);
	}
	return path.normalize(p);
}

export async function readFileTool({ files }) {
	if (!Array.isArray(files) || files.length === 0) {
		throw new Error("read_files requires a non-empty files array");
	}
	const results = [];
	for (const entry of files) {
		results.push(await readOne(entry ?? {}));
	}
	return results;
}

async function readOne({ path: filePath, start_line: startLine, end_line: endLine }) {
	let abs;
	try {
		abs = assertAbsolute(filePath);
	} catch (err) {
		return { path: filePath, error: err.message };
	}
	if (IMAGE_EXT.has(path.extname(abs).toLowerCase())) {
		return { path: abs, error: "Binary image files are not supported by this reader." };
	}
	let stat;
	try {
		stat = await fs.stat(abs);
	} catch {
		return { path: abs, error: `File not found: ${abs}` };
	}
	if (!stat.isFile()) return { path: abs, error: `Not a regular file: ${abs}` };
	if (stat.size > 2 * 1024 * 1024) {
		return { path: abs, error: `File too large (${stat.size} bytes): ${abs}` };
	}
	let raw;
	try {
		raw = await fs.readFile(abs, "utf8");
	} catch {
		return { path: abs, error: "File is not valid UTF-8 text." };
	}
	if (raw.includes("\u0000")) return { path: abs, error: "Binary file detected (NUL byte)." };

	const allLines = raw.split("\n");
	const totalLines = allLines.length;
	if (startLine == null && endLine == null) {
		const capped = allLines.slice(0, MAX_READ_LINES);
		let text = capped.join("\n");
		let truncated = totalLines > MAX_READ_LINES;
		if (text.length > MAX_READ_CHARS) {
			text = text.slice(0, MAX_READ_CHARS);
			truncated = true;
		}
		return {
			path: abs,
			total_lines: totalLines,
			truncated,
			...(truncated ? { hint: `File truncated; page through with start_line/end_line (total ${totalLines} lines).` } : {}),
			content: text,
		};
	}
	const start = Math.max(1, Number(startLine ?? 1));
	const end = Math.min(totalLines, Number(endLine ?? totalLines));
	if (start > end) return { path: abs, error: `start_line (${start}) is greater than end_line (${end})` };
	let text = allLines.slice(start - 1, end).join("\n");
	if (text.length > MAX_READ_CHARS) text = text.slice(0, MAX_READ_CHARS);
	return { path: abs, total_lines: totalLines, start_line: start, end_line: end, content: text };
}
